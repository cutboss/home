const canvas = document.getElementById('analogClock');
const ctx = canvas.getContext('2d');
const digitalText = document.getElementById('digitalTime');
const dateText = document.getElementById('digitalDate');
const themeToggle = document.getElementById('themeToggle');

// Theme Logic
themeToggle.addEventListener('click', () => {
    const isLight = document.body.getAttribute('data-theme') === 'light';
    document.body.setAttribute('data-theme', isLight ? 'dark' : 'light');
    localStorage.setItem('theme', isLight ? 'dark' : 'light');
});

// Load stored theme
const savedTheme = localStorage.getItem('theme') || 'dark';
document.body.setAttribute('data-theme', savedTheme);

function updateClocks() {
    const now = new Date();

    // Smooth time calculation
    const ms = now.getMilliseconds();
    const seconds = now.getSeconds() + ms / 1000;
    const minutes = now.getMinutes() + seconds / 60;
    const hours = (now.getHours() % 12) + minutes / 60;

    // Draw Analog Clock
    drawAnalogClock(hours, minutes, seconds);

    // Update Digital Clock
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    digitalText.textContent = `${h}:${m}:${s}`;

    // Update Date
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const date = now.getDate();
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const dayName = days[now.getDay()];
    dateText.textContent = `${year}年${month}月${date}日 (${dayName})`;

    requestAnimationFrame(updateClocks);
}

function drawAnalogClock(hours, minutes, seconds) {
    const radius = canvas.height / 2;
    const style = getComputedStyle(document.body);
    const colors = {
        background: style.getPropertyValue('--md-sys-color-background').trim(),
        onBackground: style.getPropertyValue('--md-sys-color-on-background').trim(),
        surface: style.getPropertyValue('--md-sys-color-surface-container').trim(),
        onSurface: style.getPropertyValue('--md-sys-color-on-surface').trim(),
        onSurfaceVariant: style.getPropertyValue('--md-sys-color-on-surface-variant').trim(),
        primary: style.getPropertyValue('--md-sys-color-primary').trim(),
        outline: style.getPropertyValue('--md-sys-color-outline').trim(),
        outlineVariant: style.getPropertyValue('--md-sys-color-outline-variant').trim()
    };

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(radius, radius);

    // Draw Face Border
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.9, 0, 2 * Math.PI);
    ctx.strokeStyle = colors.outlineVariant;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw Ticks
    for (let i = 0; i < 60; i++) {
        ctx.beginPath();
        if (i % 5 === 0) {
            // Hour marks
            ctx.moveTo(0, -radius * 0.82);
            ctx.lineTo(0, -radius * 0.72);
            ctx.strokeStyle = colors.onSurface;
            ctx.lineWidth = 3;
        } else {
            // Minute marks
            ctx.moveTo(0, -radius * 0.8);
            ctx.lineTo(0, -radius * 0.75);
            ctx.strokeStyle = colors.outline;
            ctx.lineWidth = 1;
        }
        ctx.stroke();
        ctx.rotate(Math.PI / 30);
    }

    // Draw Numbers
    ctx.font = `500 ${radius * 0.14}px Inter`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = colors.onSurface;
    for (let num = 1; num <= 12; num++) {
        const ang = (num * Math.PI) / 6;
        ctx.rotate(ang);
        ctx.translate(0, -radius * 0.62);
        ctx.rotate(-ang);
        ctx.fillText(num.toString(), 0, 0);
        ctx.rotate(ang);
        ctx.translate(0, radius * 0.62);
        ctx.rotate(-ang);
    }

    // Hour Hand
    drawHand(ctx, (hours * Math.PI) / 6, radius * 0.45, 8, colors.onSurface);

    // Minute Hand
    drawHand(ctx, (minutes * Math.PI) / 30, radius * 0.7, 4, colors.onSurfaceVariant);

    // Second Hand (Smooth)
    drawHand(ctx, (seconds * Math.PI) / 30, radius * 0.8, 2, colors.primary);

    // Center point
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, 2 * Math.PI);
    ctx.fillStyle = colors.onSurface;
    ctx.fill();

    ctx.restore();
}

function drawHand(ctx, pos, length, width, color) {
    ctx.beginPath();
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.rotate(pos);
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -length);
    ctx.stroke();
    ctx.rotate(-pos);
}

updateClocks();
