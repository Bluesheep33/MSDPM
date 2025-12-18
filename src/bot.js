const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { exec } = require('child_process');
const { promisify } = require('util');
const Rcon = require('rcon');
require('dotenv').config();

const execAsync = promisify(exec);

/**
 * MinecraftServerManager class to manage a Minecraft server via Discord bot.
 */
class MinecraftServerManager {
    constructor() {
        this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
        this.serverRunning = false;
        this.playerCheckInterval = null;
        this.shutdownTimer = null;
        this.rcon = null;

        // Configuration from environment variables
        this.config = {
            token: process.env.DISCORD_TOKEN,
            channelId: process.env.CHANNEL_ID,
            rconPassword: process.env.RCON_PASSWORD,
            rconHost: process.env.RCON_HOST || 'localhost',
            rconPort: parseInt(process.env.RCON_PORT) || 25575,
            serviceName: process.env.SERVICE_NAME || 'minecraft',
            checkInterval: parseInt(process.env.CHECK_INTERVAL) || 60_000, // 1 minute
            shutdownDelay: parseInt(process.env.SHUTDOWN_DELAY) || 900_000  // 15 minutes
        };

        this.setupBot().then(() => {
            console.log('✅ Bot setup complete');
        });
    }

    /**
     * Initializes the bot and sets up event handlers.
     * @returns {Promise<void>}
     */
    async setupBot() {
        // Bot event handlers
        this.client.once('ready', async () => {
            console.log(`✅ Bot is ready! Logged in as ${this.client.user.tag}`);

            // Register slash commands
            await this.registerCommands();

            // Start monitoring on startup if the server is already running
            if (await this.checkServerStatus()) {
                this.startMonitoring();
            }
        });

        // Handle interactions
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            if (interaction.commandName === 'startserver') {
                await this.handleStartCommand(interaction);
            }
        });

        // Login to Discord
        await this.client.login(this.config.token);
    }

    /**
     * Registers the slash commands for the bot.
     * @returns {Promise<void>}
     */
    async registerCommands() {
        const commands = [
            new SlashCommandBuilder()
                .setName('startserver')
                .setDescription('Start the Minecraft server')
                .toJSON()
        ];

        const rest = new REST({ version: '10' }).setToken(this.config.token);

        try {
            console.log('🔄 Registering slash commands...');
            await rest.put(
                Routes.applicationCommands(this.client.user.id),
                { body: commands }
            );
            console.log('✅ Successfully registered slash commands');
        } catch (error) {
            console.error('❌ Error registering commands:', error);
        }
    }

    /**
     * Handles the /startserver command interaction.
     * @param interaction
     * @returns {Promise<void>}
     */
    async handleStartCommand(interaction) {
        // Check if command is used in the correct channel
        if (interaction.channelId !== this.config.channelId) {
            await interaction.reply({
                content: '❌ **This command can only be used in <#' + this.config.channelId + '>**',
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply();

        try {
            // Check if the server is already running
            const status = await this.checkServerStatus();
            if (status) {
                await interaction.editReply('✅ **Minecraft server is already running!**');
                return;
            }

            // If not running, proceed to start the server
            const loadingMessages = [
                '🔄 **Sending start request to Minecraft server.**',
                '🔄 **Sending start request to Minecraft server..**',
                '🔄 **Sending start request to Minecraft server...**'
            ];

            let messageIndex = 0;
            await interaction.editReply(loadingMessages[messageIndex]);

            const loadingInterval = setInterval(async () => {
                messageIndex = (messageIndex + 1) % loadingMessages.length;
                try {
                    await interaction.editReply(loadingMessages[messageIndex]);
                } catch (error) {
                    clearInterval(loadingInterval);
                }
            }, 300);

            const success = await this.startServer();

            clearInterval(loadingInterval);

            if (success) {
                await interaction.editReply('✅ **Minecraft server started successfully!**');
                this.startMonitoring();
            } else {
                await interaction.editReply('❌ **Failed to start Minecraft server.**');
            }
        } catch (error) {
            console.error('Error handling start command:', error);
            await interaction.editReply('❌ **An error occurred while starting the server.**');
        }
    }

    /**
     * Checks if the Minecraft server is running.
     * @returns {Promise<boolean>}
     */
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

    /**
     * Starts the Minecraft server using systemctl.
     * @returns {Promise<boolean>}
     */
    async startServer() {
        try {
            // Start the server using systemctl
            await execAsync(`sudo systemctl start ${this.config.serviceName}`);

            // Update isRunning status
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
            // Stop the server using systemctl
            await execAsync(`sudo systemctl stop ${this.config.serviceName}`);

            // Update isRunning status
            this.serverRunning = false;

            // Clear any pending timers
            if (this.shutdownTimer) {
                clearTimeout(this.shutdownTimer);
                this.shutdownTimer = null;
            }
            if (this.playerCheckInterval) {
                clearInterval(this.playerCheckInterval);
                this.playerCheckInterval = null;
            }

            // Close RCON connection if it exists and reset to null
            if (this.rcon) {
                try {
                    this.rcon.disconnect();
                } catch (error) {
                    // Ignore disconnect errors
                }
                this.rcon = null;
            }

            console.log('✅ Minecraft server stopped successfully');

            return true;
        } catch (error) {
            console.error('Error stopping server:', error);
            return false;
        }
    }

    async connectRcon(retries = 3, retryDelay = 5000) {
        // Cleanup any existing stale connection
        if (this.rcon) {
            try {
                this.rcon.disconnect();
            } catch (error) {
                // Ignore disconnect errors
            }
            this.rcon = null;
        }

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                console.log(`🔄 RCON connection attempt ${attempt}/${retries}...`);

                this.rcon = new Rcon(this.config.rconHost, this.config.rconPort, this.config.rconPassword);

                // Connect with timeout
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('RCON connection timeout'));
                    }, 30000); // 30 second timeout

                    this.rcon.on('auth', () => {
                        clearTimeout(timeout);
                        resolve();
                    });
                    this.rcon.on('error', (error) => {
                        clearTimeout(timeout);
                        reject(error);
                    });
                    this.rcon.connect();
                });

                console.log('✅ RCON connected successfully');
                return this.rcon;
            } catch (error) {
                console.error(`❌ RCON connection attempt ${attempt}/${retries} failed:`, error.message);

                // Cleanup failed connection
                if (this.rcon) {
                    try {
                        this.rcon.disconnect();
                    } catch (e) {
                        // Ignore
                    }
                    this.rcon = null;
                }

                // Wait before retry if not last attempt
                if (attempt < retries) {
                    console.log(`⏳ Waiting ${retryDelay / 1000}s before next RCON connection attempt...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                }
            }
        }

        console.error('❌ Failed to connect to RCON after all retries');
        this.rcon = null;
        return null;
    }

    async sendRconCommand(command) {
        if (!this.rcon) {
            await this.connectRcon();
        }

        if (!this.rcon) {
            throw new Error('RCON not available');
        }

        return new Promise((resolve, reject) => {
            // Remove any existing listeners to prevent interference
            this.rcon.removeAllListeners('response');
            this.rcon.removeAllListeners('error');

            // Set up one-time listeners
            this.rcon.once('response', resolve);
            this.rcon.once('error', reject);

            this.rcon.send(command);
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
            // Reset RCON connection to force reconnection on next attempt
            if (this.rcon) {
                try {
                    this.rcon.disconnect();
                } catch (e) {
                    // Ignore disconnect errors
                }
                this.rcon = null;
            }
            return -1; // Return -1 to indicate error
        }
    }

    startMonitoring() {
        if (this.playerCheckInterval) {
            clearInterval(this.playerCheckInterval);
            this.playerCheckInterval = null;
        }

        if (this.shutdownTimer) {
            clearTimeout(this.shutdownTimer);
            this.shutdownTimer = null;
        }

        console.log('🔍 Starting player monitoring...');

        // Wait 30 seconds before first check to allow RCON to become available
        console.log('⏳ Waiting 30s for RCON to become available...');
        setTimeout(() => {
            this.playerCheckInterval = setInterval(async () => {
                await this.checkServerStatus();

                if (!this.serverRunning) {
                    clearInterval(this.playerCheckInterval);
                    this.playerCheckInterval = null;

                    // Clean up RCON connection and reset to null
                    if (this.rcon) {
                        try {
                            this.rcon.disconnect();
                        } catch (error) {
                            // Ignore disconnect errors
                        }
                        this.rcon = null;
                    }

                    console.log('❌ Server is no longer running, stopping player monitoring');
                    const channel = this.client.channels.cache.get(this.config.channelId);
                    if (channel) {
                        await channel.send('❌ **Minecraft server stopped (crashed or manually stopped by admin).**');
                    }
                    return;
                }

                const playerCount = await this.getOnlinePlayersCount();

                if (playerCount === -1) {
                    console.log('⚠️ Could not get player count, assuming server is still needed');
                    return;
                }

                if (playerCount > 0) {
                    if (playerCount === 1) {
                        console.log('👤 1 player online');
                    } else {
                    console.log(`👥 ${playerCount} players online`);
                    }
                    // Cancel shutdown if players are online
                    if (this.shutdownTimer) {
                        clearTimeout(this.shutdownTimer);
                        this.shutdownTimer = null;
                        console.log('✅ Shutdown cancelled - players are online');
                    }
                } else {
                    console.log('👤 No players online');
                    // Start shutdown timer if not already running
                    if (!this.shutdownTimer) {
                        console.log(`⏱️ Starting ${this.config.shutdownDelay / 1000}s shutdown timer`);
                        this.shutdownTimer = setTimeout(async () => {
                            console.log('🔄 Shutting down server due to inactivity');

                            // Notify channel about automatic shutdown with status updates
                            const channel = this.client.channels.cache.get(this.config.channelId);
                            if (channel) {
                                const loadingMessages = [
                                    '🔄 **Sending stop request to Minecraft server due to inactivity.**',
                                    '🔄 **Sending stop request to Minecraft server due to inactivity..**',
                                    '🔄 **Sending stop request to Minecraft server due to inactivity...**'
                                ];

                                let messageIndex = 0;
                                const message = await channel.send(loadingMessages[messageIndex]);

                                const loadingInterval = setInterval(async () => {
                                    messageIndex = (messageIndex + 1) % loadingMessages.length;
                                    try {
                                        await message.edit(loadingMessages[messageIndex]);
                                    } catch (error) {
                                        clearInterval(loadingInterval);
                                    }
                                }, 300);

                                const success = await this.stopServer();

                                clearInterval(loadingInterval);

                                if (success) {
                                    await message.edit('🛑 **Minecraft server stopped due to inactivity.**');
                                } else {
                                    await message.edit('❌ **Failed to stop Minecraft server.**');
                                }
                            } else {
                                await this.stopServer();
                            }
                        }, this.config.shutdownDelay);
                    }
                }
            }, this.config.checkInterval);
        }, 30000);
    }
}

// Store bot instance for graceful shutdown
let botInstance = null;

/**
 * Gracefully shuts down the bot and cleans up resources
 */
async function gracefulShutdown() {
    console.log('🔄 Shutting down bot...');

    if (botInstance) {
        // Clear any pending timers
        if (botInstance.shutdownTimer) {
            clearTimeout(botInstance.shutdownTimer);
            botInstance.shutdownTimer = null;
        }
        if (botInstance.playerCheckInterval) {
            clearInterval(botInstance.playerCheckInterval);
            botInstance.playerCheckInterval = null;
        }

        // Close RCON connection
        if (botInstance.rcon) {
            try {
                botInstance.rcon.disconnect();
            } catch (error) {
                // Ignore disconnect errors
            }
            botInstance.rcon = null;
        }

        // Destroy Discord client
        if (botInstance.client) {
            try {
                botInstance.client.destroy();
                console.log('✅ Discord client destroyed');
            } catch (error) {
                console.error('Error destroying Discord client:', error);
            }
        }
    }

    console.log('👋 Goodbye!');
    process.exit(0);
}

// Handle graceful shutdown
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Start the bot
console.log('🚀 Starting Minecraft Discord Bot...');
botInstance = new MinecraftServerManager();
