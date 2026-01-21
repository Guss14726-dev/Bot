import 'dotenv/config'
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
} from 'discord.js'

/* ================= CONFIG ================= */
const LOG_CHANNEL_ID = '1463284699987312662'
const MODMAIL_CATEGORY_ID = '1463284699987312662'
const WELCOME_CHANNEL_NAME = 'welcome'
const SUSPICIOUS_AGE_DAYS = 7

/* ================= SAFETY ================= */
process.on('unhandledRejection', console.error)
process.on('uncaughtException', console.error)

/* ================= SLASH COMMANDS ================= */
const commands = [
  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Send a message')
    .addStringOption(o =>
      o.setName('message').setDescription('Message').setRequired(true))
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Target channel')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
    .addBooleanOption(o =>
      o.setName('embed').setDescription('Send as embed')),

  new SlashCommandBuilder()
    .setName('dm')
    .setDescription('DM a user via the bot')
    .addUserOption(o =>
      o.setName('user').setDescription('Target user').setRequired(true))
    .addStringOption(o =>
      o.setName('message').setDescription('Message').setRequired(true)),

  new SlashCommandBuilder()
    .setName('suspicious_test')
    .setDescription('Check suspicious accounts')
    .addSubcommand(s =>
      s.setName('user')
        .setDescription('Check a user')
        .addUserOption(o =>
          o.setName('target').setDescription('User').setRequired(true)))
    .addSubcommand(s =>
      s.setName('all').setDescription('Check everyone'))
].map(c => c.toJSON())

/* ================= BOT ================= */
export async function setupDiscordBot () {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Message, Partials.Channel]
  })

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN)
  const tickets = new Map()

  /* ================= LOG ================= */
  async function sendLog (embed, ping = false) {
    const guild = await client.guilds.fetch(process.env.GUILD_ID)
    const channel = await guild.channels.fetch(LOG_CHANNEL_ID)
    if (!channel?.isTextBased()) return
    await channel.send({ content: ping ? '@here' : undefined, embeds: [embed] })
  }

  /* ================= JOIN ================= */
  async function handleJoin (member) {
    const age = (Date.now() - member.user.createdTimestamp) / 86400000
    const suspicious = age < SUSPICIOUS_AGE_DAYS

    const embed = new EmbedBuilder()
      .setTitle('Member Joined')
      .setColor(suspicious ? 0xff9900 : 0x2ecc71)
      .setThumbnail(member.user.displayAvatarURL())
      .addFields(
        { name: 'User', value: `${member.user.tag} (<@${member.id}>)` },
        { name: 'Account Age', value: `${age.toFixed(1)} days` }
      )
      .setTimestamp()

    await sendLog(embed, suspicious)

    const welcome = member.guild.channels.cache.find(
      c => c.type === ChannelType.GuildText && c.name === WELCOME_CHANNEL_NAME
    )
    if (welcome) await welcome.send(`Welcome <@${member.id}> 👋`)
  }

  client.on('guildMemberAdd', handleJoin)

  /* ================= MODMAIL ================= */
  client.on('messageCreate', async msg => {
    if (msg.author.bot) return

    // USER → STAFF
    if (msg.channel.type === ChannelType.DM) {
      const guild = await client.guilds.fetch(process.env.GUILD_ID)
      const category = await guild.channels.fetch(MODMAIL_CATEGORY_ID)
      if (!category) return

      let channelId = tickets.get(msg.author.id)

      if (!channelId) {
        const ch = await guild.channels.create({
          name: `modmail-${msg.author.username}`,
          type: ChannelType.GuildText,
          parent: category.id
        })
        tickets.set(msg.author.id, ch.id)
        await ch.send(`@here\nNew ModMail from **${msg.author.tag}**`)
        await msg.reply('✅ Connected to support')
        channelId = ch.id
      }

      const staff = await client.channels.fetch(channelId)
      await staff.send({
        content: `**${msg.author.tag}:** ${msg.content}`,
        files: [...msg.attachments.values()]
      })
    }

    // STAFF → USER
    if (msg.channel.parentId === MODMAIL_CATEGORY_ID) {
      const entry = [...tickets.entries()].find(e => e[1] === msg.channel.id)
      if (!entry) return

      const userId = entry[0]
      if (msg.content.startsWith('!close')) {
        tickets.delete(userId)
        await msg.channel.delete()
        return
      }

      if (msg.content.startsWith('!r ')) {
        const reply = msg.content.slice(3)
        const user = await client.users.fetch(userId)
        await user.send(reply)
        await msg.react('✅')
      }
    }
  })

  /* ================= SLASH HANDLER ================= */
  client.on('interactionCreate', async i => {
    if (!i.isChatInputCommand()) return

    if (i.commandName === 'dm') {
      if (!i.memberPermissions.has(PermissionFlagsBits.ManageMessages))
        return i.reply({ content: 'No permission', ephemeral: true })

      const user = i.options.getUser('user')
      const message = i.options.getString('message')
      await user.send(message)
      await i.reply({ content: 'DM sent', ephemeral: true })
    }

    if (i.commandName === 'suspicious_test') {
      await i.deferReply({ ephemeral: true })

      if (i.options.getSubcommand() === 'user') {
        const user = i.options.getUser('target')
        const member = await i.guild.members.fetch(user.id)
        await handleJoin(member)
      } else {
        const members = await i.guild.members.fetch()
        for (const m of members.values()) {
          const age = (Date.now() - m.user.createdTimestamp) / 86400000
          if (age < SUSPICIOUS_AGE_DAYS) await handleJoin(m)
        }
      }
      await i.editReply('Done')
    }
  })

  /* ================= READY ================= */
  client.once('ready', async () => {
    await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    )
    console.log(`Logged in as ${client.user.tag}`)
  })

  await client.login(process.env.DISCORD_TOKEN)
}
