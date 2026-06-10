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

let tideChart = null;
let chartDrawing = false;

if (typeof ChartDataLabels !== 'undefined') {
  Chart.register(ChartDataLabels);
  Chart.defaults.set('plugins.datalabels', {
    clip: false,
    clamp: false
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

async function updateTideDisplay() {
  const tempEl = document.getElementById('water-temp');
  if (!tempEl) return;

  const response = await fetch('/api/tides');
  const data = await response.json();

  document.getElementById('water-temp').textContent = `${data.temperature.v}°F`;
  document.getElementById('water-level').textContent = `${data.level.v} ft`;
  document.getElementById('tide-prediction').textContent = `${data.prediction.v} ft`;
  document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();

  const level = parseFloat(data.level.v);
  const statusEl = document.getElementById('tide-status');
  statusEl.classList.remove('status-good', 'status-caution', 'status-low');

  if (level >= 5) {
    statusEl.textContent = 'High tide — good for swimming';
    statusEl.classList.add('status-good');
  } else if (level >= 4) {
    statusEl.textContent = 'Moderate — use caution';
    statusEl.classList.add('status-caution');
  } else {
    statusEl.textContent = 'Low tide';
    statusEl.classList.add('status-low');
  }
}

async function drawTideChart() {
  const canvas = document.getElementById('tideChart');
  if (!canvas || chartDrawing) return;

  chartDrawing = true;

  try {
    const [predictionsRes, currentRes, levelRes, hiloRes] = await Promise.all([
      fetch('/api/tides/day'),
      fetch('/api/tides'),
      fetch('/api/tides/day/level'),
      fetch('/api/tides/hilo')
    ]);

    const predictions = await predictionsRes.json();
    const current = await currentRes.json();
    const levels = await levelRes.json();
    const hiloData = await hiloRes.json();

    if (!predictions?.length || !current?.level?.t || !levels?.length) {
      chartDrawing = false;
      setTimeout(drawTideChart, 1000);
      return;
    }

    const predictionPoints = predictions.map(p => ({
      x: timeToMinutes(p.t.split(' ')[1]),
      y: parseFloat(p.v)
    }));

    const levelMap = {};
    levels.forEach(l => {
      levelMap[l.t.split(' ')[1]] = parseFloat(l.v);
    });

    const actualPoints = predictions.map(p => {
      const time = p.t.split(' ')[1];
      const value = levelMap[time];
      return value !== undefined ? { x: timeToMinutes(time), y: value } : null;
    }).filter(Boolean);

    const actualByMinute = {};
    actualPoints.forEach(p => { actualByMinute[p.x] = p.y; });

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
      const actual = actualByMinute[x] ?? null;
      return {
        x,
        y: predicted,
        type: h.type,
        label: `${h.type === 'H' ? 'High' : 'Low'} · ${formatClockTime(time)} · ${predicted.toFixed(1)} ft`
      };
    });

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const currentLevel = parseFloat(current.level.v);
    const currentPoint = { x: nowMinutes, y: currentLevel };

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
          content: 'Swimming depth (5 ft)',
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
          content: 'Caution zone (4 ft)',
          color: '#9a3412',
          bgColor: 'rgba(255, 237, 213, 0.95)',
          font: { size: 12 }
        }
      };
    }

    const xValues = predictionPoints.map(p => p.x);
    const xMin = Math.min(...xValues) - 30;
    const xMax = Math.max(...xValues) + 30;

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
            tension: 0.4,
            pointRadius: 0,
            pointHitRadius: 8,
            datalabels: { display: false }
          },
          {
            label: 'Actual Water Level',
            data: actualPoints,
            borderColor: '#334155',
            backgroundColor: 'rgba(51, 65, 85, 0.08)',
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            datalabels: { display: false }
          },
          {
            label: 'Wave Highs',
            data: waveHighPoints,
            borderColor: '#166534',
            backgroundColor: '#166534',
            pointRadius: 7,
            pointHoverRadius: 9,
            showLine: false,
            datalabels: { display: false }
          },
          {
            label: 'Wave Lows',
            data: waveLowPoints,
            borderColor: '#b91c1c',
            backgroundColor: '#b91c1c',
            pointRadius: 7,
            pointHoverRadius: 9,
            showLine: false,
            datalabels: { display: false }
          },
          {
            label: 'High / Low Tides',
            data: hiloPoints,
            borderColor: '#1a6eb5',
            backgroundColor: '#ffffff',
            borderWidth: 2,
            pointRadius: 8,
            pointHoverRadius: 10,
            showLine: false,
            datalabels: {
              display: (ctx) => ctx.dataset.data[ctx.dataIndex] != null,
              align: (ctx) => ctx.dataset.data[ctx.dataIndex]?.type === 'H' ? 'top' : 'bottom',
              anchor: 'center',
              offset: 8,
              color: '#0f4c81',
              backgroundColor: 'rgba(255, 255, 255, 0.92)',
              borderColor: '#94a3b8',
              borderRadius: 6,
              borderWidth: 1,
              padding: { top: 4, bottom: 4, left: 6, right: 6 },
              font: { size: 11, weight: '600' },
              formatter: (_, ctx) => ctx.dataset.data[ctx.dataIndex]?.label || ''
            }
          },
          {
            label: 'Right Now',
            data: [currentPoint],
            borderColor: '#0f4c81',
            backgroundColor: '#0f4c81',
            pointRadius: 10,
            pointHoverRadius: 12,
            pointBorderWidth: 3,
            pointBorderColor: '#ffffff',
            showLine: false,
            datalabels: {
              display: true,
              align: 'top',
              anchor: 'center',
              offset: 12,
              color: '#ffffff',
              backgroundColor: '#0f4c81',
              borderRadius: 6,
              padding: 6,
              font: { size: 11, weight: '700' },
              formatter: () => `Now · ${currentLevel.toFixed(2)} ft`
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
        layout: {
          padding: { top: 12, right: 8, bottom: 4, left: 4 }
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
                return `${context.dataset.label}: ${context.parsed.y.toFixed(2)} ft`;
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
            grid: { color: 'rgba(148, 163, 184, 0.2)' },
            ticks: {
              maxTicksLimit: 12,
              callback: (value) => formatAxisTime(value),
              font: { size: 11 }
            }
          },
          y: {
            title: {
              display: true,
              text: 'Height (ft)',
              font: { size: 13, weight: '600' },
              color: '#475569'
            },
            grid: { color: 'rgba(148, 163, 184, 0.25)' },
            ticks: { font: { size: 11 } }
          }
        }
      }
    });
  } catch (err) {
    console.error('Chart error:', err);
  } finally {
    chartDrawing = false;
  }

  const loadingEl = document.getElementById('chart-loading');
  if (loadingEl) loadingEl.style.display = 'none';
}

async function updateHiLo() {
  const highEl = document.getElementById('next-high');
  if (!highEl) return;

  const response = await fetch('/api/tides/hilo');
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
      `${timeUntil(nextHigh.t)} · ${formatClockTime(nextHigh.t.split(' ')[1])} (${parseFloat(nextHigh.v).toFixed(1)} ft)`;
  }

  if (nextLow) {
    document.getElementById('next-low').textContent =
      `${timeUntil(nextLow.t)} · ${formatClockTime(nextLow.t.split(' ')[1])} (${parseFloat(nextLow.v).toFixed(1)} ft)`;
  }
}

updateCurrentDate();

if (document.getElementById('tideChart')) {
  drawTideChart();
  setInterval(drawTideChart, 360000);
}

if (document.getElementById('water-temp')) {
  updateTideDisplay();
  setInterval(updateTideDisplay, 360000);
}

if (document.getElementById('next-high')) {
  updateHiLo();
  setInterval(updateHiLo, 360000);
}
