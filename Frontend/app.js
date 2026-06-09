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

async function updateTideDisplay() {
  const response = await fetch('/api/tides');
  const data = await response.json();

  document.getElementById('water-temp').textContent = `${data.temperature.v}°F`;
  document.getElementById('water-level').textContent = `${data.level.v} ft`;
  document.getElementById('tide-prediction').textContent = `${data.prediction.v} ft`;
  document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();

  const level = parseFloat(data.level.v);
  const statusEl = document.getElementById('tide-status');

  if (level >= 5) {
    statusEl.textContent = 'Tide is high, good for swimming';
  } else if (level >= 4) {
    statusEl.textContent = 'Possible, be cautious of water level';
  }
}

let tideChart = null;

// Register ChartDataLabels if available
if (typeof ChartDataLabels !== 'undefined') {
  Chart.register(ChartDataLabels);
}

// Custom annotation plugin for Chart.js v3+
const annotationPlugin = {
  id: 'customAnnotations',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    const yScale = chart.scales.y;
    
    if (!chart.options.plugins?.customAnnotations?.annotations) {
      return;
    }
    
    const annotations = chart.options.plugins.customAnnotations.annotations;
    
    Object.values(annotations).forEach(annotation => {
      if (annotation.type === 'line' && annotation.yMin !== undefined) {
        const y = yScale.getPixelForValue(annotation.yMin);
        
        ctx.save();
        ctx.strokeStyle = annotation.borderColor || 'black';
        ctx.lineWidth = annotation.borderWidth || 1;
        if (annotation.borderDash) {
          ctx.setLineDash(annotation.borderDash);
        }
        
        ctx.beginPath();
        ctx.moveTo(chart.chartArea.left, y);
        ctx.lineTo(chart.chartArea.right, y);
        ctx.stroke();
        
        if (annotation.label?.display && annotation.label.content) {
          ctx.font = `${annotation.label.font?.weight || 'normal'} ${annotation.label.font?.size || 12}px ${annotation.label.font?.family || 'sans-serif'}`;
          ctx.fillStyle = annotation.label.color || 'black';
          ctx.fillText(annotation.label.content, chart.chartArea.left + 10, y - 10);
        }
        
        ctx.restore();
      }
    });
  }
};
Chart.register(annotationPlugin);

async function drawTideChart() {
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

    console.log('predictions:', predictions);
    console.log('current:', current);
    console.log('levels:', levels);

    if (!predictions || !Array.isArray(predictions) || predictions.length === 0) {
      console.log('predictions not ready, retrying...');
      setTimeout(drawTideChart, 1000);
      return;
    }
    if (!current || !current.level || !current.level.t) {
      console.log('current not ready, retrying...');
      setTimeout(drawTideChart, 1000);
      return;
    }
    if (!levels || !Array.isArray(levels) || levels.length === 0) {
      console.log('levels not ready, retrying...');
      setTimeout(drawTideChart, 1000);
      return;
    }

    const labels = predictions.map(p => {
      const [hours, minutes] = p.t.split(' ')[1].split(':');
      const h = parseInt(hours);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${minutes} ${ampm}`;
    });

    const predictionValues = predictions.map(p => parseFloat(p.v));

    const levelMap = {};
    levels.forEach(l => {
      levelMap[l.t.split(' ')[1]] = parseFloat(l.v);
    });

    const actualValues = predictions.map(p => {
      const time = p.t.split(' ')[1];
      return levelMap[time] !== undefined ? levelMap[time] : null;
    });

    const waveHighPoints = new Array(predictions.length).fill(null);
    const waveLowPoints = new Array(predictions.length).fill(null);
    for (let i = 1; i < predictionValues.length - 1; i++) {
      const prev = predictionValues[i - 1];
      const curr = predictionValues[i];
      const next = predictionValues[i + 1];
      if (curr !== null && prev !== null && next !== null) {
        if (curr > prev && curr >= next) {
          waveHighPoints[i] = curr;
        }
        if (curr < prev && curr <= next) {
          waveLowPoints[i] = curr;
        }
      }
    }

    // Build prediction hilo dots
const predHiloDots = new Array(predictions.length).fill(null);
hiloData.forEach(h => {
  const hiloTime = h.t.split(' ')[1];
  const idx = predictions.findIndex(p => p.t.split(' ')[1] === hiloTime);
  if (idx !== -1) predHiloDots[idx] = parseFloat(h.v);
});

// Build actual hilo dots — only where actual data exists
const actualHiloDots = new Array(predictions.length).fill(null);
hiloData.forEach(h => {
  const hiloTime = h.t.split(' ')[1];
  const idx = predictions.findIndex(p => p.t.split(' ')[1] === hiloTime);
  if (idx !== -1 && actualValues[idx] !== null) {
    actualHiloDots[idx] = actualValues[idx];
  }
});

// Build labels for hilo points
const hiloLabels = new Array(predictions.length).fill(null);
hiloData.forEach(h => {
  const hiloTime = h.t.split(' ')[1];
  const idx = predictions.findIndex(p => p.t.split(' ')[1] === hiloTime);
  if (idx !== -1) {
    const [hours, minutes] = hiloTime.split(':');
    const hh = parseInt(hours);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 || 12;
    hiloLabels[idx] = `${h12}:${minutes} ${ampm} (${parseFloat(h.v).toFixed(1)}ft)`;
  }
});
    const now = new Date();
    const currentHours = now.getHours().toString().padStart(2, '0');
    const currentMinutes = now.getMinutes().toString().padStart(2, '0');
    const currentTime = `${currentHours}:${currentMinutes}`;

    const currentIndex = predictions.reduce((closestIdx, p, idx) => {
      const predTime = p.t.split(' ')[1];
      const predMinutes = parseInt(predTime.split(':')[0]) * 60 + parseInt(predTime.split(':')[1]);
      const currMinutes = parseInt(currentTime.split(':')[0]) * 60 + parseInt(currentTime.split(':')[1]);
      const closestTime = predictions[closestIdx].t.split(' ')[1];
      const closestMinutes = parseInt(closestTime.split(':')[0]) * 60 + parseInt(closestTime.split(':')[1]);
      return Math.abs(predMinutes - currMinutes) < Math.abs(closestMinutes - currMinutes) ? idx : closestIdx;
    }, 0);

    console.log('currentTime:', currentTime);
    console.log('currentIndex:', currentIndex);

    const currentDot = new Array(predictions.length).fill(null);
    currentDot[currentIndex] = actualValues[currentIndex] !== null
      ? actualValues[currentIndex]
      : parseFloat(current.level.v);

    // BUILD DYNAMIC ANNOTATIONS HERE
    const currentLevel = actualValues[currentIndex] !== null
      ? actualValues[currentIndex]
      : parseFloat(current.level.v);

    const annotations = {};
    if (currentLevel >= 5) {
      annotations.highLine = {
        type: 'line',
        yMin: 5,
        yMax: 5,
        borderColor: 'green',
        borderWidth: 2,
        borderDash: [6, 4],
        label: {
          display: true,
          content: 'Good for swimming (5ft)',
          position: 'start',
          color: 'green',
          font: { size: 12 }
        }
      };
    } else if (currentLevel >= 4) {
      annotations.cautionLine = {
        type: 'line',
        yMin: 4,
        yMax: 4,
        borderColor: 'yellow',
        borderWidth: 2,
        borderDash: [6, 4],
        label: {
          display: true,
          content: 'Caution (4ft)',
          position: 'start',
          color: 'orange',
          font: { size: 12 }
        }
      };
    }
    // END ANNOTATIONS

    const ctx = document.getElementById('tideChart').getContext('2d');

    if (tideChart) {
      tideChart.destroy();
    }

    tideChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
  {
    label: 'Tide Prediction (ft)',
    data: predictionValues,
    borderColor: '#1a6eb5',
    backgroundColor: 'rgba(26, 110, 181, 0.1)',
    fill: true,
    tension: 0.4,
    pointRadius: 0,
    datalabels: { display: false }
  },
  {
    label: 'Wave High Points',
    data: waveHighPoints,
    borderColor: 'transparent',
    backgroundColor: '#006400',
    pointRadius: 8,
    pointHoverRadius: 10,
    showLine: false,
    datalabels: { display: false }
  },
  {
    label: 'Wave Low Points',
    data: waveLowPoints,
    borderColor: 'transparent',
    backgroundColor: '#b22222',
    pointRadius: 8,
    pointHoverRadius: 10,
    showLine: false,
    datalabels: { display: false }
  },
   {
    label: 'Actual Water Level (ft)',
    data: actualValues,
    borderColor: '#000000',
    backgroundColor: 'rgba(97, 97, 97, 0.1)',
    fill: true,
    tension: 0.4,
    pointRadius: 0,
    datalabels: { display: false }
  },
  {
    label: 'Current Level (ft)',
    data: currentDot,
    borderColor: 'black',
    backgroundColor: 'black',
    pointRadius: 8,
    pointHoverRadius: 10,
    showLine: false,
    datalabels: { display: false }  // ← add here
  },
  // Dataset 4 — prediction hilo points
  {
  label: 'Predicted High/Low',
  data: predHiloDots,
  borderColor: '#1a6eb5',
  backgroundColor: '#1a6eb5',
  pointRadius: 6,
  pointHoverRadius: 8,
  showLine: false,
  datalabels: {
    display: true,
    align: 'top',
    anchor: 'end',
    color: '#1a6eb5',
    font: { size: 11, weight: 'bold' },
    formatter: (value, context) => {
      if (value === null) return '';
      const label = hiloLabels[context.dataIndex];
      return label ? label : '';
    }
  }
},
// Dataset 5 — actual hilo points
{
  label: 'Actual High/Low',
  data: actualHiloDots,
  borderColor: '#555555',
  backgroundColor: '#555555',
  pointRadius: 6,
  pointHoverRadius: 8,
  showLine: false,
  datalabels: {
    display: true,
    align: 'top',
    anchor: 'end',
    color: '#555555',
    font: { size: 11, weight: 'bold' },
    formatter: (value, context) => {
      if (value === null) return '';
      const label = hiloLabels[context.dataIndex];
      return label ? label : '';
    }
  }
}
        ]
      },
  options: {
  responsive: true,
  plugins: {
    legend: {
      labels: {
        font: { size: 14, family: 'sans-serif' }
      }
    },
    tooltip: {
      callbacks: {
        label: function(context) {
          const idx = context.dataIndex;
          if (context.datasetIndex === 5 && hiloLabels[idx]) {
            return hiloLabels[idx];
          }
          if (context.datasetIndex === 6 && hiloLabels[idx]) {
            return `Actual: ${hiloLabels[idx]}`;
          }
          return `${context.parsed.y.toFixed(2)} ft`;
        }
      }
    },
    customAnnotations: {
      annotations: annotations
    }
  },
  scales: {
    x: {
      ticks: {
        maxTicksLimit: 24,
        font: { size: 12, family: 'sans-serif' }
      }
    },
    y: {
      title: {
        display: true,
        text: 'Height (ft)',
        font: { size: 14, weight: 'bold' }
      },
      ticks: {
        font: { size: 12 }
      }
    }
  }
}
    });

  } catch (err) {
    console.error('Chart error:', err);
  }
  document.getElementById('chart-loading').style.display = 'none';
}

async function updateHiLo() {
  const response = await fetch('/api/tides/hilo');
  const predictions = await response.json();

  const now = new Date();

  const upcoming = predictions.filter(p => {
    const [date, time] = p.t.split(' ');
    const [hours, minutes] = time.split(':');
    const predTime = new Date();
    predTime.setHours(parseInt(hours), parseInt(minutes), 0);
    return predTime > now;
  });

  const nextHigh = upcoming.find(p => p.type === 'H');
  const nextLow = upcoming.find(p => p.type === 'L');

  function formatTime(t) {
    const [hours, minutes] = t.split(' ')[1].split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
  }

  function timeUntil(t) {
    const [date, time] = t.split(' ');
    const [hours, minutes] = time.split(':');
    const predTime = new Date();
    predTime.setHours(parseInt(hours), parseInt(minutes), 0);
    const diffMs = predTime - now;
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffMins = Math.floor((diffMs % 3600000) / 60000);
    return diffHrs > 0 ? `In ${diffHrs}h ${diffMins}m` : `In ${diffMins}m`;
  }

  if (nextHigh) {
    document.getElementById('next-high').textContent =
      `${timeUntil(nextHigh.t)} at ${formatTime(nextHigh.t)} (${parseFloat(nextHigh.v).toFixed(1)} ft)`;
  }

  if (nextLow) {
    document.getElementById('next-low').textContent =
      `${timeUntil(nextLow.t)} at ${formatTime(nextLow.t)} (${parseFloat(nextLow.v).toFixed(1)} ft)`;
  }
}

updateCurrentDate();

drawTideChart();
setInterval(drawTideChart, 360000); 

updateTideDisplay();
setInterval(updateTideDisplay, 360000);

updateHiLo();
setInterval(updateHiLo, 360000);