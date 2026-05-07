require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const APPFOLIO_CLIENT_ID = process.env.APPFOLIO_CLIENT_ID;
const APPFOLIO_CLIENT_SECRET = process.env.APPFOLIO_CLIENT_SECRET;
const APPFOLIO_DEVELOPER_ID = process.env.APPFOLIO_DEVELOPER_ID;
const APPFOLIO_BASE = 'https://api.appfolio.com/api/v0';

function getHeaders() {
  const encoded = Buffer.from(`${APPFOLIO_CLIENT_ID}:${APPFOLIO_CLIENT_SECRET}`).toString('base64');
  return {
    'Authorization': `Basic ${encoded}`,
    'X-AppFolio-Developer-ID': APPFOLIO_DEVELOPER_ID,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

async function fetchAppFolio(endpoint, params = {}) {
  const url = new URL(`${APPFOLIO_BASE}/${endpoint}`);
  if (!params['filters[LastUpdatedAtFrom]'] && !params['filters[Id]']) {
    params['filters[LastUpdatedAtFrom]'] = '1970-01-01T00:00:00Z';
  }
  params['page[number]'] = params['page[number]'] || '1';
  params['page[size]'] = params['page[size]'] || '1000';
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const resp = await fetch(url.toString(), { headers: getHeaders() });
  if (!resp.ok) {
    const text = await resp.text();
    return { error: `AppFolio ${resp.status}`, detail: text.slice(0, 300), url: url.toString() };
  }
  return resp.json();
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'AppFolio proxy running' });
});

app.get('/test', async (req, res) => {
  const data = await fetchAppFolio('units');
  if (data.error) return res.status(400).json(data);
  res.json({
    status: 'connected',
    unit_count: data.data?.length || 0,
    sample: data.data?.[0] || null
  });
});

// Portfolio snapshot — units + portfolios + leases
app.get('/snapshot', async (req, res) => {
  const [portfolios, units, leases] = await Promise.all([
    fetchAppFolio('portfolios'),
    fetchAppFolio('units'),
    fetchAppFolio('leases')
  ]);
  res.json({ portfolios, units, leases });
});

// UW snapshot
app.get('/uw-snapshot', async (req, res) => {
  const [portfolios, units, leases, charges] = await Promise.all([
    fetchAppFolio('portfolios'),
    fetchAppFolio('units'),
    fetchAppFolio('leases'),
    fetchAppFolio('recurring_charges')
  ]);
  res.json({ portfolios, units, leases, recurring_charges: charges });
});

// Pass-through for any endpoint
app.get('/appfolio/:endpoint', async (req, res) => {
  const data = await fetchAppFolio(req.params.endpoint, { ...req.query });
  res.json(data);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`AppFolio proxy running on port ${PORT}`));
