// PM2 Ecosystem Config — Zeus Terminal
const path = require('path');

module.exports = {
    apps: [{
        name: 'zeus',
        script: 'server.js',
        // [SEC-23 2026-06-10] system node at /usr/local/bin (copy of nvm
        // v20.20.2 in /opt/node) — the zeus user cannot reach /root/.nvm.
        interpreter: '/usr/local/bin/node',
        cwd: path.resolve(__dirname),
        instances: 1,
        exec_mode: 'fork',
        autorestart: true,
        watch: false,
        max_memory_restart: '1536M', // [2026-06-05] 512M caused pm2 auto-restarts every ~8-10h (proc grows ~30MB/h) → boot burst → 418 ban roulette; VPS has 7.6G
        exp_backoff_restart_delay: 100,
        env: {
            NODE_ENV: 'production',
        },
        // Graceful shutdown
        kill_timeout: 5000,
        listen_timeout: 8000,
        shutdown_with_message: true,
        // Log management
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
        error_file: path.join(__dirname, 'data', 'logs', 'pm2-error.log'),
        out_file: path.join(__dirname, 'data', 'logs', 'pm2-out.log'),
        merge_logs: true,
        max_size: '10M',       // rotate when log reaches 10 MB
        retain: 5,             // keep last 5 rotated files
    }],
};
