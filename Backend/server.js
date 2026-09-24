const express = require('express');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, '../frontend')));

app.get(['/blog.html', '/projects.html'], (req, res) => {
  res.redirect('/');
});

const NORWALK = '8468448';
const BRIDGEPORT = '8467150';
const NOAA_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const NOAA_PARAMS = 'units=english&time_zone=lst_ldt&datum=MLLW&format=json';
const MIN_DAY_POINTS = 100;
const MAX_PREDICTION_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 1000;

async function fetchNoaa(query) {
  const response = await fetch(`${NOAA_BASE}?${query}&${NOAA_PARAMS}`);
  if (!response.ok) {
    throw new Error(`NOAA request failed (${response.status})`);
  }
  return response.json();
}

function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':');
  return parseInt(hours, 10) * 60 + parseInt(minutes, 10);
}

function nearestPrediction(predictions) {
  if (!predictions?.length) return null;

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return predictions.reduce((closest, point) => {
    const pointMinutes = timeToMinutes(point.t.split(' ')[1]);
    const closestMinutes = timeToMinutes(closest.t.split(' ')[1]);
    return Math.abs(pointMinutes - nowMinutes) < Math.abs(closestMinutes - nowMinutes)
      ? point
      : closest;
  });
}

async function fetchTodayPredictions(retries = MAX_PREDICTION_ATTEMPTS) {
  let predictions = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    const data = await fetchNoaa(
      `station=${NORWALK}&product=predictions&date=today`
    );
    predictions = data.predictions;
    if (predictions?.length >= MIN_DAY_POINTS) {
      return predictions;
    }
    if (attempt < retries - 1) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return predictions;
}

// Current conditions route
app.get('/api/tides', async (req, res) => {
  try {
    const [predictions, waterLevel, waterTemp, airTemp] = await Promise.all([
      fetchTodayPredictions(),
      fetchNoaa(`station=${BRIDGEPORT}&product=water_level&date=latest`),
      fetchNoaa(`station=${BRIDGEPORT}&product=water_temperature&date=latest`),
      fetchNoaa(`station=${BRIDGEPORT}&product=air_temperature&date=latest`)
    ]);

    const level = waterLevel.data?.[0];
    const temperature = waterTemp.data?.[0];
    const airTemperature = airTemp.data?.[0];
    const prediction = nearestPrediction(predictions) || predictions?.[0];

    if (!level || !temperature || !prediction) {
      return res.status(503).json({ error: 'Current tide data unavailable' });
    }

    res.json({ prediction, level, temperature, airTemperature });
  } catch (err) {
    console.error('Error in /api/tides:', err.message);
    res.status(503).json({ error: 'Failed to fetch current tide data' });
  }
});

// Full day predictions route
app.get('/api/tides/day', async (req, res) => {
  try {
    const predictions = await fetchTodayPredictions();

    if (!predictions?.length || predictions.length < MIN_DAY_POINTS) {
      return res.status(503).json({
        error: 'Incomplete tide predictions',
        count: predictions?.length || 0
      });
    }

    res.json(predictions);
  } catch (err) {
    console.error('Error in /api/tides/day:', err.message);
    res.status(503).json({ error: 'Failed to fetch daily tide predictions' });
  }
});

// Full day water level route
app.get('/api/tides/day/level', async (req, res) => {
  try {
    const data = await fetchNoaa(
      `station=${BRIDGEPORT}&product=water_level&date=today`
    );
    const levels = data.data || [];

    if (levels.length < 10) {
      return res.status(503).json({
        error: 'Incomplete water level data',
        count: levels.length
      });
    }

    res.json(levels);
  } catch (err) {
    console.error('Error in /api/tides/day/level:', err.message);
    res.status(503).json({ error: 'Failed to fetch daily water levels' });
  }
});

app.get('/api/tides/hilo', async (req, res) => {
  try {
    const data = await fetchNoaa(
      `station=${NORWALK}&product=predictions&date=today&interval=hilo`
    );
    const predictions = data.predictions || [];

    if (!predictions.length) {
      return res.status(503).json({ error: 'High/low tide data unavailable' });
    }

    res.json(predictions);
  } catch (err) {
    console.error('Error in /api/tides/hilo:', err.message);
    res.status(503).json({ error: 'Failed to fetch high/low tide data' });
  }
});

app.listen(3000, () => console.log('Running at http://localhost:3000'));
