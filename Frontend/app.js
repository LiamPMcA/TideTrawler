function updateCurrentDate() {
  const dateEl = document.getElementById('current-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }
}

function timeToMinutes(timeStr) {
  const [hours, minutes, seconds = '0'] = timeStr.split(':');
  return parseInt(hours, 10) * 60 + parseInt(minutes, 10) + parseInt(seconds, 10) / 60;
}

function formatClockTime(timeStr) {
  const [hours, minutes] = timeStr.split(':');
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${minutes} ${ampm}`;
}

function formatAxisTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function interpolateAt(points, targetMinutes) {
  if (!points.length) return null;

  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (targetMinutes <= sorted[0].x) return sorted[0].y;
  if (targetMinutes >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y;

  for (let i = 0; i < sorted.length - 1; i++) {
    const left = sorted[i];
    const right = sorted[i + 1];
    if (targetMinutes >= left.x && targetMinutes <= right.x) {
      const range = right.x - left.x;
      if (range === 0) return left.y;
      const progress = (targetMinutes - left.x) / range;
      return left.y + (right.y - left.y) * progress;
    }
  }

  return null;
}

function showChartLoading(message) {
  const loadingEl = document.getElementById('chart-loading');
  if (loadingEl) {
    loadingEl.textContent = message;
    loadingEl.style.display = 'block';
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${url} (${response.status})`);
  }
  return response.json();
}

const MIN_PREDICTIONS = 100;
let tideChart = null;
let chartDrawing = false;
let chartRetryCount = 0;

if (typeof ChartDataLabels !== 'undefined') {
  Chart.register(ChartDataLabels);
  Chart.defaults.set('plugins.datalabels', {
    clip: false,
    clamp: true
  });
}

const annotationPlugin = {
  id: 'customAnnotations',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    const { chartArea } = chart;
    const yScale = chart.scales.y;
    const xScale = chart.scales.x;
    const plugins = chart.options.plugins?.customAnnotations;
    if (!plugins) return;

    if (plugins.nowMinutes != null) {
      const x = xScale.getPixelForValue(plugins.nowMinutes);
      ctx.save();
      ctx.strokeStyle = 'rgba(15, 76, 129, 0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    }

    const annotations = plugins.annotations || {};
    Object.values(annotations).forEach(annotation => {
      if (annotation.type !== 'line' || annotation.yMin === undefined) return;

      const y = yScale.getPixelForValue(annotation.yMin);
      ctx.save();
      ctx.strokeStyle = annotation.borderColor || '#333';
      ctx.lineWidth = annotation.borderWidth || 2;
      if (annotation.borderDash) ctx.setLineDash(annotation.borderDash);

      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.stroke();

      if (annotation.label?.display && annotation.label.content) {
        const text = annotation.label.content;
        const fontSize = annotation.label.font?.size || 12;
        ctx.font = `600 ${fontSize}px "Segoe UI", sans-serif`;
        const metrics = ctx.measureText(text);
        const padX = 8;
        const padY = 5;
        const boxW = metrics.width + padX * 2;
        const boxH = fontSize + padY * 2;
        const boxX = chartArea.right - boxW - 8;
        const boxY = y - boxH / 2;

        ctx.fillStyle = annotation.label.bgColor || 'rgba(255, 255, 255, 0.92)';
        ctx.strokeStyle = annotation.borderColor || '#333';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxW, boxH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = annotation.label.color || '#111';
        ctx.fillText(text, boxX + padX, boxY + boxH - padY - 2);
      }

      ctx.restore();
    });
  }
};
Chart.register(annotationPlugin);

function formatLive(value, suffix = '') {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return '--';
  return `${n.toFixed(2)}${suffix}`;
}

function mergeActualWithLatest(actualPoints, levelReading, nowMinutes) {
  const latestY = parseFloat(levelReading.v);
  const latestMinutes = timeToMinutes(levelReading.t.split(' ')[1]);

  if (Number.isNaN(latestY)) {
    return { linePoints: actualPoints, dotY: null, dotX: nowMinutes };
  }

  const linePoints = actualPoints.filter(
    p => Math.abs(p.x - latestMinutes) > 2 && Math.abs(p.x - nowMinutes) > 2
  );

  linePoints.push({ x: latestMinutes, y: latestY });
  if (nowMinutes > latestMinutes + 0.5) {
    linePoints.push({ x: nowMinutes, y: latestY });
  }

  linePoints.sort((a, b) => a.x - b.x);
  return { linePoints, dotY: latestY, dotX: nowMinutes };
}

function applyCurrentConditions(data) {
  const tempEl = document.getElementById('water-temp');
  if (!tempEl) return;

  document.getElementById('water-temp').textContent = `${formatLive(data.temperature.v)}°F`;
  document.getElementById('water-level').textContent = `${formatLive(data.level.v)} Ft`;
  document.getElementById('tide-prediction').textContent = `${formatLive(data.prediction.v)} Ft`;

  const airTempEl = document.getElementById('air-temp');
  if (airTempEl) {
    airTempEl.textContent = data.airTemperature?.v
      ? `${formatLive(data.airTemperature.v)}°F`
      : '--';
  }

  document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();

  const level = parseFloat(data.level.v);
  const statusEl = document.getElementById('tide-status');

  if (level >= 5) {
    statusEl.textContent = 'High tide — good for swimming';
  } else if (level >= 4) {
    statusEl.textContent = 'Moderate — use caution';
  } else {
    statusEl.textContent = 'Low tide';
  }
}

async function updateTideDisplay() {
  const tempEl = document.getElementById('water-temp');
  if (!tempEl) return;

  const response = await fetch('/api/tides');
  if (!response.ok) return;

  applyCurrentConditions(await response.json());
}

async function drawTideChart() {
  const canvas = document.getElementById('tideChart');
  if (!canvas || chartDrawing) return;

  chartDrawing = true;

  try {
    const [predictions, current, levels, hiloData] = await Promise.all([
      fetchJson('/api/tides/day'),
      fetchJson('/api/tides'),
      fetchJson('/api/tides/day/level'),
      fetchJson('/api/tides/hilo')
    ]);

    if (
      !Array.isArray(predictions) ||
      predictions.length < MIN_PREDICTIONS ||
      !current?.level?.t ||
      !Array.isArray(levels) ||
      levels.length < 10 ||
      !Array.isArray(hiloData) ||
      !hiloData.length
    ) {
      throw new Error('Incomplete tide data received');
    }

    chartRetryCount = 0;
    applyCurrentConditions(current);

    const predictionPoints = predictions.map(p => ({
      x: timeToMinutes(p.t.split(' ')[1]),
      y: parseFloat(p.v)
    }));

    const actualPoints = levels
      .map(l => ({
        x: timeToMinutes(l.t.split(' ')[1]),
        y: parseFloat(l.v)
      }))
      .filter(p => !Number.isNaN(p.y))
      .sort((a, b) => a.x - b.x);

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const { linePoints: actualLine, dotY, dotX } = mergeActualWithLatest(
      actualPoints,
      current.level,
      nowMinutes
    );

    if (dotY == null) {
      throw new Error('Could not resolve current water level');
    }

    const currentLevel = dotY;
    const currentPoint = { x: dotX, y: dotY };

    const waveHighPoints = [];
    const waveLowPoints = [];
    for (let i = 1; i < predictionPoints.length - 1; i++) {
      const prev = predictionPoints[i - 1].y;
      const curr = predictionPoints[i].y;
      const next = predictionPoints[i + 1].y;
      if (curr > prev && curr >= next) {
        waveHighPoints.push({ x: predictionPoints[i].x, y: curr });
      }
      if (curr < prev && curr <= next) {
        waveLowPoints.push({ x: predictionPoints[i].x, y: curr });
      }
    }

    const hiloPoints = hiloData.map(h => {
      const time = h.t.split(' ')[1];
      const x = timeToMinutes(time);
      const predicted = parseFloat(h.v);
      const onCurve = interpolateAt(predictionPoints, x);
      return {
        x,
        y: onCurve ?? predicted,
        type: h.type,
        label: `${h.type === 'H' ? 'High' : 'Low'} ${formatClockTime(time)} · ${predicted.toFixed(1)} Ft`
      };
    });

    const annotations = {};
    if (currentLevel >= 5) {
      annotations.highLine = {
        type: 'line',
        yMin: 5,
        borderColor: '#1b8a5a',
        borderWidth: 2,
        borderDash: [8, 4],
        label: {
          display: true,
          content: 'Swimming depth (5 Ft)',
          color: '#0d5c3a',
          bgColor: 'rgba(209, 250, 229, 0.95)',
          font: { size: 12 }
        }
      };
    } else if (currentLevel >= 4) {
      annotations.cautionLine = {
        type: 'line',
        yMin: 4,
        borderColor: '#c2410c',
        borderWidth: 2,
        borderDash: [8, 4],
        label: {
          display: true,
          content: 'Caution zone (4 Ft)',
          color: '#9a3412',
          bgColor: 'rgba(255, 237, 213, 0.95)',
          font: { size: 12 }
        }
      };
    }

    const xMin = Math.max(0, predictionPoints[0].x - 30);
    const xMax = predictionPoints[predictionPoints.length - 1].x + 30;

    const ctx = canvas.getContext('2d');
    if (tideChart) tideChart.destroy();

    tideChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'Tide Prediction',
            data: predictionPoints,
            borderColor: '#1a6eb5',
            backgroundColor: 'rgba(26, 110, 181, 0.12)',
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            pointHitRadius: 8,
            datalabels: { display: false }
          },
          {
            label: 'Actual Water Level',
            data: actualLine,
            borderColor: '#334155',
            backgroundColor: 'rgba(51, 65, 85, 0.08)',
            fill: true,
            tension: 0.15,
            pointRadius: 0,
            spanGaps: false,
            datalabels: { display: false }
          },
          {
            type: 'scatter',
            label: 'Wave Highs',
            data: waveHighPoints,
            borderColor: '#166534',
            backgroundColor: '#166534',
            pointRadius: 7,
            pointHoverRadius: 9,
            pointStyle: 'circle',
            datalabels: { display: false }
          },
          {
            type: 'scatter',
            label: 'Wave Lows',
            data: waveLowPoints,
            borderColor: '#b91c1c',
            backgroundColor: '#b91c1c',
            pointRadius: 7,
            pointHoverRadius: 9,
            pointStyle: 'circle',
            datalabels: { display: false }
          },
          {
            type: 'scatter',
            label: 'High / Low Tides',
            data: hiloPoints,
            borderColor: '#1a6eb5',
            backgroundColor: '#ffffff',
            borderWidth: 2,
            pointRadius: 7,
            pointHoverRadius: 9,
            pointStyle: 'circle',
            pointBorderWidth: 2,
            pointBorderColor: '#1a6eb5',
            datalabels: {
              display: (ctx) => ctx.dataset.data[ctx.dataIndex] != null,
              // High peaks sit near the top — label below; lows sit near the bottom — label above
              align: (ctx) => ctx.dataset.data[ctx.dataIndex]?.type === 'H' ? 'bottom' : 'top',
              anchor: (ctx) => {
                const point = ctx.dataset.data[ctx.dataIndex];
                if (!point || !ctx.chart?.scales?.x) return 'center';
                const { min, max } = ctx.chart.scales.x;
                const range = max - min || 1;
                const rel = (point.x - min) / range;
                if (rel < 0.06) return 'start';
                if (rel > 0.94) return 'end';
                return 'center';
              },
              offset: 10,
              clamp: true,
              color: '#0f4c81',
              backgroundColor: 'rgba(255, 255, 255, 0.96)',
              borderColor: '#94a3b8',
              borderRadius: 6,
              borderWidth: 1,
              padding: { top: 3, bottom: 3, left: 5, right: 5 },
              font: { size: 10, weight: '600' },
              formatter: (_, ctx) => ctx.dataset.data[ctx.dataIndex]?.label || ''
            }
          },
          {
            type: 'scatter',
            label: 'Right Now',
            data: [currentPoint],
            borderColor: '#ffffff',
            backgroundColor: '#000000',
            pointRadius: 8,
            pointHoverRadius: 10,
            pointStyle: 'circle',
            pointBorderWidth: 2,
            pointBorderColor: '#ffffff',
            datalabels: {
              display: true,
              align: 'bottom',
              anchor: 'center',
              offset: 10,
              clamp: true,
              color: '#0f4c81',
              backgroundColor: 'rgba(255, 255, 255, 0.96)',
              borderColor: '#94a3b8',
              borderWidth: 1,
              borderRadius: 6,
              padding: 5,
              font: { size: 10, weight: '700' },
              formatter: () => `Now · ${currentLevel.toFixed(2)} Ft`
            }
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        resizeDelay: 200,
        animation: false,
        interaction: { mode: 'nearest', intersect: false },
        parsing: false,
        elements: {
          point: {
            hoverRadius: 9
          }
        },
        layout: {
          padding: { top: 36, right: 8, bottom: 36, left: 8 }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              usePointStyle: true,
              padding: 18,
              font: { size: 12, family: '"Segoe UI", sans-serif' }
            }
          },
          tooltip: {
            backgroundColor: '#0f172a',
            titleFont: { size: 13 },
            bodyFont: { size: 12 },
            padding: 10,
            callbacks: {
              title: (items) => formatAxisTime(items[0].parsed.x),
              label: (context) => {
                const point = context.dataset.data[context.dataIndex];
                if (point?.label) return point.label;
                return `${context.dataset.label}: ${context.parsed.y.toFixed(2)} Ft`;
              }
            }
          },
          customAnnotations: {
            nowMinutes: nowMinutes,
            annotations
          }
        },
        scales: {
          x: {
            type: 'linear',
            min: xMin,
            max: xMax,
            offset: false,
            grid: { color: 'rgba(148, 163, 184, 0.2)' },
            ticks: {
              maxTicksLimit: 10,
              padding: 6,
              callback: (value) => formatAxisTime(value),
              font: { size: 11 }
            }
          },
          y: {
            min: 0,
            grace: '8%',
            title: {
              display: true,
              text: 'Height (Ft)',
              font: { size: 13, weight: '600' },
              color: '#475569'
            },
            grid: { color: 'rgba(148, 163, 184, 0.25)' },
            ticks: {
              font: { size: 11 },
              callback: (value) => value < 0 ? '' : value
            }
          }
        }
      }
    });
    const loadingEl = document.getElementById('chart-loading');
    if (loadingEl) loadingEl.style.display = 'none';
  } catch (err) {
    console.error('Chart error:', err);
    chartRetryCount += 1;
    const waitMs = Math.min(1000 * chartRetryCount, 5000);
    showChartLoading('Waiting for complete tide data...');
    setTimeout(drawTideChart, waitMs);
  } finally {
    chartDrawing = false;
  }
}

async function updateHiLo() {
  const highEl = document.getElementById('next-high');
  if (!highEl) return;

  const response = await fetch('/api/tides/hilo');
  if (!response.ok) return;

  const predictions = await response.json();
  const now = new Date();

  const upcoming = predictions.filter(p => {
    const [, time] = p.t.split(' ');
    const [hours, minutes] = time.split(':');
    const predTime = new Date();
    predTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0);
    return predTime > now;
  });

  const nextHigh = upcoming.find(p => p.type === 'H');
  const nextLow = upcoming.find(p => p.type === 'L');

  function timeUntil(t) {
    const [, time] = t.split(' ');
    const [hours, minutes] = time.split(':');
    const predTime = new Date();
    predTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0);
    const diffMs = predTime - now;
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);
    return diffHrs > 0 ? `In ${diffHrs}h ${diffMins}m` : `In ${diffMins}m`;
  }

  if (nextHigh) {
    document.getElementById('next-high').textContent =
      `${timeUntil(nextHigh.t)} · ${formatClockTime(nextHigh.t.split(' ')[1])} (${parseFloat(nextHigh.v).toFixed(1)} Ft)`;
  }

  if (nextLow) {
    document.getElementById('next-low').textContent =
      `${timeUntil(nextLow.t)} · ${formatClockTime(nextLow.t.split(' ')[1])} (${parseFloat(nextLow.v).toFixed(1)} Ft)`;
  }
}

updateCurrentDate();

if (document.getElementById('tideChart')) {
  drawTideChart();
  setInterval(drawTideChart, 360000);
} else if (document.getElementById('water-temp')) {
  updateTideDisplay();
  setInterval(updateTideDisplay, 360000);
}

if (document.getElementById('next-high')) {
  updateHiLo();
  setInterval(updateHiLo, 360000);
}
