// index.js
const express    = require('express');
const bodyParser = require('body-parser');
const fetch      = require('node-fetch');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes
} = require('discord.js');

// —— CONFIG (via Render environment variables) ——
const DISCORD_TOKEN    = process.env.DISCORD_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const OWNER_ROLE_ID    = process.env.OWNER_ROLE_ID;
const SECRET_KEY       = process.env.SECRET_KEY;
const BRIDGE_URL       = process.env.BRIDGE_URL;
const PORT             = process.env.PORT || 3000;

// In-memory job queue
let jobQueue = [];

// —— EXPRESS SERVICE ——
const app = express();
app.use(bodyParser.json());

// 1) Enqueue a job (called by Discord command handler)
app.post('/enqueue', (req, res) => {
  if (req.headers['x-secret'] !== SECRET_KEY) return res.sendStatus(403);
  const { action, userId } = req.body;
  if (action === 'clean' && Number.isInteger(userId)) {
    jobQueue.push({ action, userId });
    return res.send({ status: 'queued' });
  }
  res.sendStatus(400);
});

// 2) Roblox polls here for pending jobs
app.get('/jobs', (req, res) => {
  if (req.query.key !== SECRET_KEY) return res.sendStatus(403);
  const jobs = jobQueue.slice();
  jobQueue = [];
  res.send(jobs);
});

app.listen(PORT, () =>
  console.log(`Bridge running on port ${PORT}`)
);

// —— DISCORD BOT ——
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once('ready', async () => {
  console.log('Discord bot ready');
  // Register the /clean slash command in your guild
  const rest = new REST({ version: '10' })
    .setToken(DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      client.user.id,
      DISCORD_GUILD_ID
    ),
    {
      body: [{
        name: 'clean',
        description: 'Wipe plot data for a Roblox user',
        options: [{
          name: 'userid',
          description: 'Roblox UserId to clean',
          type: 4, // INTEGER
          required: true
        }]
      }]
    }
  );
});

client.on('interactionCreate', async interaction => {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== 'clean'
  ) return;

  // Only allow your Owner role
  if (
    !interaction.member.roles.cache.has(OWNER_ROLE_ID)
  ) {
    return interaction.reply({
      content: '❌ You are not authorized.',
      ephemeral: true
    });
  }

  const userId = interaction.options.getInteger('userid');
  try {
    const resp = await fetch(
      `${BRIDGE_URL}/enqueue`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-secret': SECRET_KEY
        },
        body: JSON.stringify({
          action: 'clean',
          userId
        })
      }
    );
    if (!resp.ok) throw new Error(await resp.text());
    interaction.reply(
      `✅ Cleanup queued for user ${userId}.`
    );
  } catch (err) {
    console.error(err);
    interaction.reply({
      content: '❌ Failed to queue cleanup.',
      ephemeral: true
    });
  }
});

client.login(DISCORD_TOKEN);
