const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { exec } = require('child_process');
const { promisify } = require('util');
const Rcon = require('rcon');
require('dotenv').config();

const execAsync = promisify(exec);

class MinecraftServerManager {
    constructor() {
        this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
        this.serverRunning = false;
        this.lastPlayerCheckTime = null;
        this.playerCheckInterval = null;
        this.rcon = null;

        // Configuration from environment variables
        this.config = {
            token: process.env.DISCORD_TOKEN,
            channelId: process.env.CHANNEL_ID,
            rconPassword: process.env.RCON_PASSWORD,
            rconHost: process.env.RCON_HOST || 'localhost',
            rconPort: parseInt(process.env.RCON_PORT) || 25575,
            serviceName: process.env.SERVICE_NAME || 'minecraft-server',
            checkInterval: parseInt(process.env.CHECK_INTERVAL) || 60_000, // 1 minute
            shutdownDelay: parseInt(process.env.SHUTDOWN_DELAY) || 900_000  // 15 minutes
        };

        this.setupBot().then(r => {
            console.log('✅ Bot setup complete');
        });
    }

    async setupBot() {
        // Register slash commands
        await this.registerCommands();

        // Bot event handlers
        this.client.once('ready', () => {
            console.log(`✅ Bot is ready! Logged in as ${this.client.user.tag}`);
            this.checkServerStatus();
        });

        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            if (interaction.commandName === 'startmc') {
                await this.handleStartCommand(interaction);
            }
        });

        // Login to Discord
        await this.client.login(this.config.token);
    }

    async registerCommands() {
        const commands = [
            new SlashCommandBuilder()
                .setName('startmc')
                .setDescription('Start the Minecraft server')
                .toJSON()
        ];

        const rest = new REST({ version: '10' }).setToken(this.config.token);

        try {
            console.log('🔄 Registering slash commands...');
            await rest.put(
                Routes.applicationCommands(this.client.user?.id || 'temp'),
                { body: commands }
            );
            console.log('✅ Successfully registered slash commands');
        } catch (error) {
            console.error('❌ Error registering commands:', error);
        }
    }

    async handleStartCommand(interaction) {
        // Check if command is used in the correct channel
        if (interaction.channelId !== this.config.channelId) {
            await interaction.reply({
                content: '❌ This command can only be used in <#' + this.config.channelId + '>',
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply();

        try {
            const status = await this.checkServerStatus();

            if (status) {
                await interaction.editReply('✅ Minecraft server is already running!');
                return;
            }

            await interaction.editReply('🔄 Starting Minecraft server...');

            const success = await this.startServer();

            if (success) {
                await interaction.editReply('✅ Minecraft server started successfully!');
                this.startPlayerMonitoring();
            } else {
                await interaction.editReply('❌ Failed to start Minecraft server.');
            }
        } catch (error) {
            console.error('Error handling start command:', error);
            await interaction.editReply('❌ An error occurred while starting the server.');
        }
    }

    async checkServerStatus() {
        try {
            const { stdout } = await execAsync(`systemctl is-active ${this.config.serviceName}`);
            this.serverRunning = stdout.trim() === 'active';
            return this.serverRunning;
        } catch (error) {
            this.serverRunning = false;
            return false;
        }
    }

    async startServer() {
        try {
            await execAsync(`sudo systemctl start ${this.config.serviceName}`);

            // Wait a moment for the service to start
            await new Promise(resolve => setTimeout(resolve, 3000));

            const isRunning = await this.checkServerStatus();

            if (isRunning) {
                console.log('✅ Minecraft server started successfully');
                return true;
            } else {
                console.log('❌ Server failed to start');
                return false;
            }
        } catch (error) {
            console.error('Error starting server:', error);
            return false;
        }
    }

    async stopServer() {
        try {
            await execAsync(`sudo systemctl stop ${this.config.serviceName}`);
            this.serverRunning = false;

            console.log('✅ Minecraft server stopped successfully');

            // Notify channel
            const channel = this.client.channels.cache.get(this.config.channelId);
            if (channel) {
                await channel.send('🔴 Minecraft server stopped due to inactivity.');
            }

            return true;
        } catch (error) {
            console.error('Error stopping server:', error);
            return false;
        }
    }

    async connectRcon() {
        if (this.rcon) return this.rcon;

        try {
            this.rcon = new Rcon(this.config.rconHost, this.config.rconPort, this.config.rconPassword);
            await new Promise((resolve, reject) => {
                this.rcon.on('auth', resolve);
                this.rcon.on('error', reject);
                this.rcon.connect();
            });
            console.log('✅ RCON connected successfully');
            return this.rcon;
        } catch (error) {
            console.error('❌ Failed to connect to RCON:', error);
            this.rcon = null;
            return null;
        }
    }

    async sendRconCommand(command) {
        if (!this.rcon) {
            await this.connectRcon();
        }

        if (!this.rcon) {
            throw new Error('RCON not available');
        }

        return new Promise((resolve, reject) => {
            this.rcon.send(command);
            this.rcon.on('response', resolve);
            this.rcon.on('error', reject);
        });
    }

    async getOnlinePlayersCount() {
        try {
            const response = await this.sendRconCommand('list');
            // Parse response like "There are 2 of a max of 20 players online: player1, player2"
            const match = response.match(/There are (\d+) of a max/);
            return match ? parseInt(match[1]) : 0;
        } catch (error) {
            console.error('Error getting player count:', error);
            return -1; // Return -1 to indicate error
        }
    }

    startPlayerMonitoring() {
        if (this.playerCheckInterval) {
            clearInterval(this.playerCheckInterval);
        }

        this.lastPlayerCheckTime = Date.now();

        this.playerCheckInterval = setInterval(async () => {
            if (!this.serverRunning) {
                clearInterval(this.playerCheckInterval);
                return;
            }

            const playerCount = await this.getOnlinePlayersCount();

            if (playerCount === -1) {
                // Error getting player count, assume server is still needed
                console.log('⚠️  Could not get player count, assuming server is still needed');
                this.lastPlayerCheckTime = Date.now();
                return;
            }

            if (playerCount > 0) {
                // Players online, reset timer
                this.lastPlayerCheckTime = Date.now();
                console.log(`👥 ${playerCount} players online`);
            } else {
                // No players online
                const timeSinceLastPlayer = Date.now() - this.lastPlayerCheckTime;
                const remainingTime = this.config.shutdownDelay - timeSinceLastPlayer;

                console.log(`👤 No players online for ${Math.round(timeSinceLastPlayer / 1000)}s`);

                if (timeSinceLastPlayer >= this.config.shutdownDelay) {
                    console.log('🔄 Shutting down server due to inactivity');
                    clearInterval(this.playerCheckInterval);
                    await this.stopServer();
                } else {
                    console.log(`⏱️  Server will shut down in ${Math.round(remainingTime / 1000)}s if no players join`);
                }
            }
        }, this.config.checkInterval);

        console.log('🔍 Started player monitoring');
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('🔄 Shutting down bot...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🔄 Shutting down bot...');
    process.exit(0);
});

// Start the bot
const bot = new MinecraftServerManager();

console.log('🚀 Starting Minecraft Discord Bot...');