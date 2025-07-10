# MSDPM
### Minecraft Server Daemon Process Manager

With this tool you can minimize power consumption of your Minecraft server by automatically shutting it down after a certain time of inactivity and starting it again when prompted by a user through discord.

## Installation
- Clone repository
- Ensure your `server.properties` file inside the folder of your minecraft server has RCON enabled:
  ```dotenv 
  enable-rcon=true
  rcon.port=25575
  rcon.password=your_rcon_password_here
  ```
- Edit `.env` with your configuration:
  ```dotenv
  DISCORD_TOKEN: Your Discord bot token
  CHANNEL_ID: The Discord channel ID where the bot should respond to commands
  SERVICE_NAME: Your systemd service name (e.g., "minecraft-server")
  RCON_PASSWORD: Your Minecraft server's RCON password
  RCON_HOST: Usually "localhost" if running on the same machine
  RCON_PORT: Usually 25575 (default RCON port)
  ```
- Configure sudo permissions for the user running the bot to allow starting and stopping the Minecraft server without a password:
  
  Run the following command to edit the sudoers file
  ```bash
  sudo visudo
  ```
  Then add the following lines at the end of the file
  ```bash
  user ALL=(ALL) NOPASSWD: /bin/systemctl start service_name
  user ALL=(ALL) NOPASSWD: /bin/systemctl stop service_name
  user ALL=(ALL) NOPASSWD: /bin/systemctl is-active service_name
  ```
  where `user` should be the name of the user running the bot and `service_name` the name of your Minecraft server systemd service.
- Run the bot using `npm start` or `node src/bot.js`
  - Ideally use a process manager like `pm2` or `systemctl` to run the bot as a background service