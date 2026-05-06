require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const APPFOLIO_CLIENT_ID = process.env.APPFOLIO_CLIENT_ID;
const APPFOLIO_CLIENT_SECRET = process.env.APPFOLIO_CLIENT_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const APPFOLIO_BASE = 'https://api.appfolio.com/api/v1';

function getBasicAuth() {
  return 'Basic ' + Buffer.from(`${APPFOLIO_CLIENT_ID}:${APPFOLIO_CLIENT_SECRET}`).toString('base64');
}

async function fetchAppFolio(endpoint, params = {}) {
  const url = new URL(`${APPFOLIO_BASE}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const resp = await fetch(url.toString(), {
    headers: {
      'Authorization': getBasicAuth(),
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });
  if (!resp.ok) {
    const text = await resp.text();
    return { error: `AppFolio ${resp.status}: ${text.slice(0, 200)}` };
  }
  return resp.json();
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'AppFolio proxy running' });
});

// Test AppFolio connection
app.get('/test', async (req, res) => {
  const data = await fetchAppFolio('properties');
  if (data.error) return res.status(400).json(data);
  res.json({
    status: 'connected',
    properties: data.results?.length || data.total_count || 0
  });
});

// Raw AppFolio data endpoint (for debugging)
app.get('/appfolio/:endpoint', async (req, res) => {
  const data = await fetchAppFolio(req.params.endpoint, req.query);
  res.json(data);
});

// Main ask endpoint — fetches AppFolio data + calls Claude
app.post('/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Missing question' });

  const q = question.toLowerCase();

  // Determine which endpoints to hit based on the question
  const endpoints = new Set();
  if (q.includes('occupanc') || q.includes('vacant') || q.includes('availab') || q.includes('overview') || q.includes('portfolio')) endpoints.add('units');
  if (q.includes('rent roll') || q.includes('rent') || q.includes('income') || q.includes('monthly') || q.includes('gross')) endpoints.add('rent-roll');
  if (q.includes('lease') || q.includes('expir') || q.includes('renew')) endpoints.add('leases');
  if (q.includes('delinquent') || q.includes('overdue') || q.includes('balance') || q.includes('owed') || q.includes('collect')) endpoints.add('delinquencies');
  if (q.includes('propert') || q.includes('building') || q.includes('overview') || q.includes('portfolio')) endpoints.add('properties');
  if (q.includes('mainten') || q.includes('repair') || q.includes('work order')) endpoints.add('maintenance_requests');
  if (q.includes('tenant') || q.includes('resident')) endpoints.add('tenants');
  if (endpoints.size === 0) { endpoints.add('properties'); endpoints.add('units'); }

  // Fetch all relevant endpoints in parallel
  const fetchPromises = [...endpoints].map(async ep => {
    const data = await fetchAppFolio(ep);
    return [ep, data];
  });
  const results = await Promise.all(fetchPromises);
  const appfolioData = Object.fromEntries(results);

  // Trim data to avoid blowing Claude's context
  const context = JSON.stringify(appfolioData, null, 2).slice(0, 10000);

  // Call Claude
  const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You are an expert real estate asset manager for Diamond National Investments (DNI), analyzing live AppFolio data for their Atlanta multifamily portfolio — 6 multifamily properties, 1 commercial, over 1,250 doors. Answer with specific numbers, percentages, and actionable insights. Be direct and concise. Format currency with $ and commas. If an endpoint returned an error, explain clearly what it means.`,
      messages: [
        { role: 'user', content: `Live AppFolio data:\n\n${context}\n\nQuestion: ${question}` }
      ]
    })
  });

  const claudeData = await claudeResp.json();
  const answer = claudeData.content?.[0]?.text || 'No response from Claude.';

  res.json({
    answer,
    endpoints_fetched: [...endpoints],
    raw: appfolioData
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AppFolio proxy running on port ${PORT}`));
