const express = require('express');
const path = require('path');
const app = express();
app.use(express.static(path.join(__dirname, '../frontend')));

// Current conditions route
app.get('/api/tides', async (req, res) => {
  const NORWALK = '8468448';
  const BRIDGEPORT = '8467150';
  const BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&units=english&time_zone=lst_ldt&datum=MLLW&format=json';

  const [tidesRes, waterLevelRes, waterTempRes] = await Promise.all([
    fetch(`${BASE}&station=${NORWALK}&product=predictions`),
    fetch(`${BASE}&station=${BRIDGEPORT}&product=water_level`),
    fetch(`${BASE}&station=${BRIDGEPORT}&product=water_temperature`)
  ]);

  const [tides, waterLevel, waterTemp] = await Promise.all([
    tidesRes.json(),
    waterLevelRes.json(),
    waterTempRes.json()
  ]);

  res.json({
    prediction: tides.predictions[0],
    level: waterLevel.data[0],
    temperature: waterTemp.data[0]
  });
});

// Full day predictions route — with retry logic
app.get('/api/tides/day', async (req, res) => {
  let predictions = null;
  let attempts = 0;

  while (!predictions || predictions.length < 100) {
    const response = await fetch(
      'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=8468448&product=predictions&date=today&units=english&time_zone=lst_ldt&datum=MLLW&format=json'
    );
    const data = await response.json();
    predictions = data.predictions;
    attempts++;
    if (attempts >= 5) break;
  }

  res.json(predictions);
});

// Full day water level route
app.get('/api/tides/day/level', async (req, res) => {
  const response = await fetch(
    'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=8467150&product=water_level&date=today&units=english&time_zone=lst_ldt&datum=MLLW&format=json'
  );
  const data = await response.json();
  res.json(data.data);
});

app.get('/api/tides/hilo', async (req, res) => {
  const response = await fetch(
    'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=8468448&product=predictions&date=today&units=english&time_zone=lst_ldt&datum=MLLW&interval=hilo&format=json'
  );
  const data = await response.json();
  res.json(data.predictions);
});

app.listen(3000, () => console.log('Running at http://localhost:3000'));