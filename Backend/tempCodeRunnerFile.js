const express = require('express');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, '../frontend')));

// Tide data route
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

  // Send a clean combined object to the frontend
  res.json({
    prediction: tides.predictions[0],
    level: waterLevel.data[0],
    temperature: waterTemp.data[0]
  });

});

app.get('/api/tides/day', async (req, res) => {
  const response = await fetch(
    'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?station=8468448&product=predictions&date=today&units=english&time_zone=lst_ldt&datum=MLLW&format=json'
  );

  const data = await response.json();
  res.json(data.predictions);
  });

app.listen(3000, () => console.log('Running at http://localhost:3000'));