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
  Where `user` should be the name of the user running the bot and `service_name` the name of your Minecraft server systemd service.
  - If you don't have a systemd service for your Minecraft server, you can create one. A sample service file is provided in the `systemd` folder of this repository, be sure to edit it to match your Minecraft server's configuration.
- Run the bot to start registering the slash command for Discord. Once you see the message "✅ Successfully registered slash commands" in your console, you can stop the bot.
  - Please refer to [Usage](#usage) on how to run the bot. Note that for registering the slash command, it doesn't matter if the Minecraft server is running or not.
- Wait for a few hours maximum to ensure the slash command is registered properly on the Discord servers. Be sure to reopen your Discord client when checking for this to prevent caching issues.

## Usage
- Run the bot using `npm start` or `node src/bot.js`
  - Ideally use a process manager like `pm2` or `systemctl` to run the bot as a background service. I've provided a sample systemd service file in the `systemd` folder, be sure to edit it to match your bot's configuration.
  - Note: the Minecraft server should not be running when you start the bot, because the bot will only start checking the server status after it has been started by the bot itself.
- Use `/startserver` in the Discord channel to start the Minecraft server