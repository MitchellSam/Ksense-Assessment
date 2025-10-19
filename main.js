import 'dotenv/config'
import axios from 'axios';

const BASE_URL = 'https://assessment.ksensetech.com/api';
const API_KEY = process.env.KSENSE_API_KEY;

const CLIENT = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-api-key': API_KEY, 'Content-Type': 'application/json' },
});

const MAX_RETRIES = 5;
const DELAY_MS = 1000;

async function requestWithRetries(config) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await CLIENT.request(config);
      return resp;
    } catch (err) {
      const status = err.response && err.response.status;
      const retryable = status === 429 || (status >= 500 && status < 600) || !err.response;
      if (!retryable || attempt > MAX_RETRIES) throw err;
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
  throw new Error('unreachable');
}

async function fetchAllPatients(limit = 20) {
  let page = 1;
  const all = [];
  while (true) {
    const params = { page, limit };
    const resp = await requestWithRetries({ method: 'GET', url: '/patients', params });
    if (resp.status !== 200) throw new Error(`Unexpected status ${resp.status}`);
    const body = resp.data;
    let items = body.data || [];
    if (!items.length) break;
    all.push(...items);
    if (items.length < limit) break;
    page++;
  }
  return all;
}

function parseBP(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  const sys = parseInt(m[1], 10);
  const dia = parseInt(m[2], 10);
  if (Number.isNaN(sys) || Number.isNaN(dia)) return null;
  return [sys, dia];
}

function bpScore(sys, dia) {
  function scoreSys(s) {
    if (s >= 140) return 3;
    if (s >= 130 && s <= 139) return 2;
    if (s >= 120 && s <= 129) return 1;
    return 0;
  }
  function scoreDia(d) {
    if (d >= 90) return 3;
    if (d >= 80 && d <= 89) return 2;
    if (d >= 80) return 0;
  }
  return Math.max(scoreSys(sys), scoreDia(dia));
}

function parseTemperature(input) {
  if (input == null) return null;
  if (typeof input === 'number') return input;
  const s = String(input).trim();
  if (!s) return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isNaN(n) ? null : n;
}

function temperatureScore(f) {
  if (f >= 101.0) return 2;
  if (f >= 99.6 && f <= 100.9) return 1;
  return 0;
}

function parseAge(input) {
  if (input == null) return null;
  if (typeof input === 'number') return input;
  const s = String(input).trim();
  if (!s) return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isNaN(n) ? null : n;
}

function ageScore(age) {
  if (age > 65) return 2;
  if (age >= 0) return 1;
  return 0;
}

function buildAlertLists(patients) {
  const high_risk = [];
  const fever = [];
  const data_quality_issues = [];

  for (const p of patients) {
    const pid = p.patient_id;
    if (!pid) continue;

    const bpData = p.blood_pressure;
    const temperatureData = p.temperature;
    const ageData = p.age;

    const bp = parseBP(bpData);
    const temperature = parseTemperature(temperatureData);
    const age = parseAge(ageData);

    let hasIssue = false;
    let bpPts = 0, temperaturePts = 0, agePts = 0;

    if (bp == null) hasIssue = true;
    else bpPts = bpScore(bp[0], bp[1]);

    if (temperature == null) hasIssue = true;
    else temperaturePts = temperatureScore(temperature);

    if (age == null) hasIssue = true;
    else agePts = ageScore(age);

    const total = bpPts + temperaturePts + agePts;
    if (total >= 4) high_risk.push(pid);
    if (temperature != null && temperature >= 99.6) fever.push(pid);
    if (hasIssue) data_quality_issues.push(pid);
  }

  return { high_risk_patients: high_risk, fever_patients: fever, data_quality_issues };
}

async function submitAssessment(payload) {
  try {
    const resp = await requestWithRetries({ method: 'POST', url: '/submit-assessment', data: payload });
    return resp.data;
  } catch (err) {
    console.error('Failed to submit assessment:', err.message || err);
    throw err;
  }
}

async function main() {
  try {
    const patients = await fetchAllPatients(20);
    const payload = buildAlertLists(patients);
    const result = await submitAssessment(payload);
    console.log('Submission result:', result);
  } catch (err) {
    console.error('Error:', err.message || err);
    process.exitCode = 1;
  }
}

main();