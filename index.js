/* ================= KEEP ALIVE (RRHOSTING SAFE) ================= */
const http = require("http");
http.createServer((_, res) => {
  res.writeHead(200);
  res.end("Online");
}).listen(process.env.PORT || 3000);

/* ================= DISCORD ================= */
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
} = require("discord.js");

/* ================= CONFIG ================= */
const DISCORD_TOKEN = process.env.DISCORD_TOKEN; // Use environment variables
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const MODMAIL_CATEGORY_ID = process.env.MODMAIL_CATEGORY_ID;
const WELCOME_CHANNEL_NAME = "welcome";
const SUSPICIOUS_AGE_DAYS = 7;

/* ================= SAFETY ================= */
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);

/* ================= COMMANDS ================= */
const commands = [
  new SlashCommandBuilder()
    .setName("dm")
    .setDescription("DM a user")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addStringOption(o => o.setName("message").setRequired(true)),

  new SlashCommandBuilder()
    .setName("suspicious_test")
    .setDescription("Check suspicious accounts")
    .addSubcommand(s =>
      s.setName("user").addUserOption(o => o.setName("target").setRequired(true))
    )
    .addSubcommand(s => s.setName("all"))
].map(c => c.toJSON());

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
const tickets = new Map();

/* ================= LOG ================= */
async function sendLog(embed, ping = false) {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(LOG_CHANNEL_ID);
    if (channel?.isTextBased()) {
      await channel.send({ content: ping ? "@here" : undefined, embeds: [embed] });
    }
  } catch (err) {
    console.error("Failed to send log:", err);
  }
}

/* ================= JOIN ================= */
client.on("guildMemberAdd", async member => {
  const age = (Date.now() - member.user.createdTimestamp) / 86400000;
  const suspicious = age < SUSPICIOUS_AGE_DAYS;

  const embed = new EmbedBuilder()
    .setTitle("Member Joined")
    .setColor(suspicious ? 0xff9900 : 0x2ecc71)
    .addFields(
      { name: "User", value: `${member.user.tag}` },
      { name: "Account Age", value: `${age.toFixed(1)} days` }
    )
    .setTimestamp();

  await sendLog(embed, suspicious);

  const welcome = member.guild.channels.cache.find(
    c => c.type === ChannelType.GuildText && c.name === WELCOME_CHANNEL_NAME
  );
  if (welcome) welcome.send(`Welcome <@${member.id}> 👋`);
});

/* ================= MODMAIL ================= */
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;

  // USER DM
  if (msg.channel.type === ChannelType.DM) {
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const category = await guild.channels.fetch(MODMAIL_CATEGORY_ID);
      if (!category) return;

      let channelId = tickets.get(msg.author.id);
      if (!channelId) {
        const channel = await guild.channels.create({
          name: `modmail-${msg.author.username}`,
          type: ChannelType.GuildText,
          parent: category.id
        });
        tickets.set(msg.author.id, channel.id);
        await channel.send("@here");
        await msg.reply("✅ Connected to support");
        channelId = channel.id;
      }

      const staffChannel = await client.channels.fetch(channelId);
      await staffChannel.send(`**User:** ${msg.author.tag}\n${msg.content}`);
    } catch (err) {
      console.error("Modmail DM error:", err);
    }
  }

  // STAFF REPLY
  if (msg.channel.parentId === MODMAIL_CATEGORY_ID) {
    const userId = [...tickets.entries()].find(e => e[1] === msg.channel.id)?.[0];
    if (!userId) return;

    if (msg.content.startsWith("!close")) {
      tickets.delete(userId);
      await msg.channel.delete();
      return;
    }

    if (msg.content.startsWith("!r")) {
      const reply = msg.content.slice(2).trim();
      try {
        const user = await client.users.fetch(userId);
        await user.send(reply);
        await msg.react("✅");
      } catch (err) {
        console.error("Failed to send staff reply:", err);
      }
    }
  }
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  if (i.commandName === "dm") {
    if (!i.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
      return i.reply({ content: "No permission", ephemeral: true });
    }

    const user = i.options.getUser("user");
    const message = i.options.getString("message");

    try {
      await user.send(message);
      i.reply({ content: "Sent", ephemeral: true });
    } catch {
      i.reply({ content: "DM failed", ephemeral: true });
    }
  }
});

/* ================= READY ================= */
client.once("ready", async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log(`ONLINE: ${client.user.tag}`);
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
});

/* ================= START ================= */
client.login(DISCORD_TOKEN);
