# MSDPM
### Minecraft Server Daemon Process Manager

With this tool you can minimize power consumption of your Minecraft server by automatically shutting it down after a certain time of inactivity and starting it again when prompted by a user through discord.

## Installation
- Clone repository
- Open RCON port in mc server's`server.properties`
- Fill in values in `.env` file
- Run bot using `npm start` or `node src/bot.js`
  - Ideally use a process manager like `pm2` or `systemctl` to run the bot in the background