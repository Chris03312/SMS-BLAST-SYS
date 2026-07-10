/**
 * ecosystem.config.js — PM2 process manager configuration.
 *
 * Keeps the SystemBlast server running 24/7. If the process crashes
 * or is killed, PM2 restarts it automatically within seconds.
 *
 * Usage:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.js
 *   pm2 save              # save process list for auto-start on reboot
 *   pm2 startup           # generate systemd/init script for boot
 *
 * Logs:
 *   pm2 logs systemblast
 *   pm2 status
 *   pm2 monit
 */

module.exports = {
  apps: [
    {
      name: 'systemblast',
      script: './apps/web/index.js',
      cwd: __dirname,
      // Auto-restart on crash or exit
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,           // wait 3s between restarts

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,

      // Resource limits
      max_memory_restart: '500M',    // restart if memory exceeds 500MB
      min_uptime: '10s',             // considered started after 10s

      // Environment
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
