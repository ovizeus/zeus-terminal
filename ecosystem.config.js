// PM2 Ecosystem Config — Zeus Terminal
const path = require('path');

module.exports = {
    apps: [{
        name: 'zeus',
        script: 'server.js',
        cwd: path.resolve(__dirname),
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '512M',
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
