import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import session from "express-session";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";

dotenv.config({ override: true });
console.log("[ENV_INFO] Loaded DISCORD_CLIENT_ID:", process.env.DISCORD_CLIENT_ID);
import { 
  Client, 
  GatewayIntentBits, 
  ChannelType, 
  PermissionsBitField, 
  PermissionFlagsBits,
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle,
  InteractionType,
  StringSelectMenuBuilder,
  TextChannel,
  GuildMember,
  ColorResolvable
} from 'discord.js';

async function startServer() {
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  const app = express();
  const CONFIG_PATH = path.join(process.cwd(), "config.json");

  let botConfig: any = {
    server: { port: 3000, host: "0.0.0.0" },
    app: { 
      name: "RS TEAM", 
      version: "unknown",
      branding: {
        primaryColor: "#c5a059",
        logo: "",
        banner: "",
        footer: ""
      }
    },
    botSettings: {
      intents: ["Guilds", "GuildMessages", "MessageContent"],
      defaultActivity: "",
      defaultStatus: "online"
    },
    globalSystemEmbeds: {
      alreadyHasTicket: { title: "", description: "", color: "" },
      ticketWarning: { title: "", description: "", color: "" }
    },
    globalDiscord: {
      guildId: "",
      adminRoleId: "",
      staffRoleId: "",
      logChannelId: "",
      ticketCategoryId: "",
      transcriptChannelId: ""
    },
    instances: []
  };

  function loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const data = fs.readFileSync(CONFIG_PATH, "utf-8");
        const parsed = JSON.parse(data);
        
        // Migrate old format if needed
        if (parsed.instances && !parsed.server) {
           botConfig.instances = parsed.instances;
        } else {
           botConfig = { ...botConfig, ...parsed };
        }
      }
    } catch (err) {
      console.error("[CONFIG_ERROR] Failed to load config.json:", err);
    }
  }

  function saveConfig() {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(botConfig, null, 2), "utf-8");
    } catch (err) {
      console.error("[CONFIG_ERROR] Failed to save config.json:", err);
    }
  }

  loadConfig();
  
  const PORT = botConfig.server?.port || 3000;

  app.set("trust proxy", 1);
  app.use(cookieParser());
  app.use(session({
    secret: process.env.SESSION_SECRET || "rsteam-secret-key-123456",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      sameSite: "none",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    }
  }));

  app.use(express.json());
  
  const apiRouter = express.Router();
  app.use("/api", apiRouter);

  apiRouter.get("/ping", (req, res) => {
    res.json({ 
      message: "pong", 
      time: new Date().toISOString(), 
      version: botConfig.app?.version || "3.5" 
    });
  });

  const botClients = new Map<string, Client>();

  function isSnowflake(id: string | null | undefined): boolean {
    return !!(id && /^\d{17,21}$/.test(id));
  }

  async function startBotInstance(instanceId: string) {
    const instance = botConfig.instances.find(i => i.id === instanceId);
    if (!instance || !instance.token) return;

    // Check if token is a generic placeholder or clearly invalid
    const tokenClean = instance.token.trim();
    if (
      tokenClean.includes("YOUR_") || 
      tokenClean.includes("TOKEN") || 
      tokenClean.length < 20 || 
      !tokenClean.includes(".")
    ) {
      console.warn(`[BOT_INFO_${instanceId}] Bot token is empty, placeholder or invalid format. Skipping login attempt.`);
      instance.status = "خطأ في التوكن";
      saveConfig();
      return;
    }

    try {
      if (botClients.has(instanceId)) {
        await botClients.get(instanceId)?.destroy().catch(() => null);
        botClients.delete(instanceId);
      }

      const intents = (botConfig.botSettings?.intents || [
        'Guilds', 
        'GuildMessages', 
        'MessageContent'
      ]).map((intent: string) => (GatewayIntentBits as any)[intent]);

      const client = new Client({
        intents: intents
      });

      client.on('ready', () => {
        console.log(`[BOT_${instance.id}] Logged in as ${client.user?.tag}!`);
        instance.status = "متصل";
        
        if (botConfig.botSettings?.defaultActivity) {
          client.user?.setActivity(botConfig.botSettings.defaultActivity);
        }
        
        saveConfig();
      });

      client.on('interactionCreate', async (interaction) => {
        handleInteraction(interaction, instance);
      });

      botClients.set(instanceId, client);
      await client.login(instance.token);
    } catch (err: any) {
      console.warn(`[BOT_WARN_${instanceId}] Login failed (this is handled gracefully):`, err.message);
      instance.status = "خطأ في التوكن";
      saveConfig();
    }
  }

  // --- Ticket Creation Helper ---
  async function createTicket(interaction: any, sector: any, answers: any[], instance: any) {
    const openChannel = interaction.guild.channels.cache.find((c: any) => 
      c.name === `ticket-${interaction.user.username.toLowerCase()}` || 
      (c.name.startsWith(`ticket-`) && c.topic === interaction.user.id)
    );

    if (openChannel) {
      const embedConfig = instance?.systemEmbeds?.alreadyHasTicket || botConfig.globalSystemEmbeds?.alreadyHasTicket || {
        title: "❌ لديك تذكرة مفتوحة",
        description: "أغلق تذكرتك الحالية أولاً لفتح تذكرة جديدة.",
        color: "#FF0000"
      };
      const errEmbed = new EmbedBuilder()
        .setTitle(embedConfig.title || "❌ لديك تذكرة مفتوحة")
        .setDescription((embedConfig.description || "أغلق تذكرتك الحالية أولاً لفتح تذكرة جديدة.").replace("{channel}", `<#${openChannel.id}>`))
        .setColor((embedConfig.color || "#FF0000") as ColorResolvable);
      
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ embeds: [errEmbed] }).catch(() => null);
      } else {
        return interaction.reply({ embeds: [errEmbed], ephemeral: true }).catch(() => null);
      }
    }

    const categoryId = isSnowflake(sector.categoryId) ? sector.categoryId : (isSnowflake(botConfig.globalDiscord?.ticketCategoryId) ? botConfig.globalDiscord?.ticketCategoryId : undefined);
    const staffRoleId = isSnowflake(sector.staffRoleId) ? sector.staffRoleId : (isSnowflake(botConfig.globalDiscord?.staffRoleId) ? botConfig.globalDiscord?.staffRoleId : undefined);
    const adminRoleId = isSnowflake(botConfig.globalDiscord?.adminRoleId) ? botConfig.globalDiscord?.adminRoleId : undefined;

    const permissionOverwrites = [
      {
        id: interaction.guild.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles
        ]
      }
    ];

    if (staffRoleId && isSnowflake(staffRoleId)) {
      permissionOverwrites.push({
        id: staffRoleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles
        ]
      });
    }

    if (adminRoleId && isSnowflake(adminRoleId)) {
      permissionOverwrites.push({
        id: adminRoleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles
        ]
      });
    }

    try {
      const ticketChannel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: categoryId || null,
        topic: interaction.user.id,
        permissionOverwrites: permissionOverwrites
      });

      const welcomeEmbed = new EmbedBuilder()
        .setTitle(`تذكرة جديدة - ${sector.name}`)
        .setDescription(`مرحباً بك ${interaction.user} في تذكرتك.\nسيقوم فريق الدعم بالرد عليك في أقرب وقت ممكن.`)
        .setColor((botConfig.app?.branding?.primaryColor || "#c5a059") as ColorResolvable);

      if (sector.ticketLogoUrl) {
        welcomeEmbed.setThumbnail(sector.ticketLogoUrl);
      } else if (botConfig.app?.branding?.logo) {
        welcomeEmbed.setThumbnail(botConfig.app.branding.logo);
      }

      if (sector.ticketBannerUrl) {
        welcomeEmbed.setImage(sector.ticketBannerUrl);
      } else if (botConfig.app?.branding?.banner) {
        welcomeEmbed.setImage(botConfig.app.branding.banner);
      }

      if (botConfig.app?.branding?.footer) {
        welcomeEmbed.setFooter({ text: botConfig.app.branding.footer });
      }

      if (answers && answers.length > 0) {
        answers.forEach((ans: any) => {
          welcomeEmbed.addFields({ name: ans.label, value: ans.value || "لا توجد إجابة", inline: false });
        });
      }

      const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`close_ticket:${interaction.user.id}`)
          .setLabel("إغلاق التذكرة")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`claim_ticket`)
          .setLabel("استلام التذكرة")
          .setEmoji("🙋‍♂️")
          .setStyle(ButtonStyle.Success)
      );

      const mentionStr = `${interaction.user} ${staffRoleId ? `<@&${staffRoleId}>` : ""}`;
      await ticketChannel.send({
        content: mentionStr,
        embeds: [welcomeEmbed],
        components: [actionRow]
      });

      const successEmbed = new EmbedBuilder()
        .setDescription(`✅ تم إنشاء تذكرتك بنجاح: ${ticketChannel}`)
        .setColor("#10B981");

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [successEmbed] }).catch(() => null);
      } else {
        await interaction.reply({ embeds: [successEmbed], ephemeral: true }).catch(() => null);
      }

      // Send logs if logsChannelId is configured
      const rawLogsChannelId = sector.logsChannelId || botConfig.globalDiscord?.logChannelId;
      const logsChannelId = isSnowflake(rawLogsChannelId) ? rawLogsChannelId : undefined;
      if (logsChannelId) {
        const logsChannel = await interaction.guild.channels.fetch(logsChannelId).catch(() => null);
        if (logsChannel && logsChannel.isTextBased()) {
          const logEmbed = new EmbedBuilder()
            .setTitle("📝 تذكرة جديدة مفتوحة")
            .setColor("#3B82F6")
            .addFields(
              { name: "العضو", value: `${interaction.user} (${interaction.user.id})`, inline: true },
              { name: "القسم", value: sector.name, inline: true },
              { name: "قناة التذكرة", value: `${ticketChannel}`, inline: true }
            )
            .setTimestamp();
          await (logsChannel as any).send({ embeds: [logEmbed] }).catch(() => null);
        }
      }

    } catch (createErr: any) {
      console.error("[TICKET_CREATE_ERR]", createErr);
      const errResponse = { embeds: [new EmbedBuilder().setDescription(`❌ فشل إنشاء قناة التذكرة. يرجى التحقق من صلاحيات البوت والـ Category. الخطأ: ${createErr.message}`).setColor("#EF4444")] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errResponse).catch(() => null);
      } else {
        await interaction.reply({ ...errResponse, ephemeral: true }).catch(() => null);
      }
    }
  }

  // --- Interaction Logic ---
  async function handleInteraction(interaction: any, instance: any) {
    if (!interaction.guild) return;

    try {
      // Check for allowed role restriction if opening a ticket
      const isOpeningTicket = (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('ticket_modal:')) ||
                              (interaction.isButton() && interaction.customId.startsWith('ticket_btn:'));

      if (isOpeningTicket && instance.allowedRoleId && isSnowflake(instance.allowedRoleId)) {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !member.roles.cache.has(instance.allowedRoleId)) {
          const role = await interaction.guild.roles.fetch(instance.allowedRoleId).catch(() => null);
          const roleMention = role ? `<@&${role.id}>` : "الرتبة المعينة للبوت";
          const errEmbed = new EmbedBuilder()
            .setTitle("🔒 رتبة مطلوبة للوصول")
            .setDescription(`عذراً، يجب أن تمتلك رتبة ${roleMention} لتتمكن من استخدام هذا البوت وفتح التذاكر.`)
            .setColor("#EF4444");
          return interaction.reply({ embeds: [errEmbed], ephemeral: true }).catch(() => null);
        }
      }

      if (interaction.type === InteractionType.ModalSubmit) {
        if (interaction.customId.startsWith('ticket_modal:')) {
          const sectorId = interaction.customId.split(':')[1];
          let sector: any = null;
          for (const panel of instance.panels) {
            sector = panel.sectors.find((s: any) => s.id === sectorId);
            if (sector) break;
          }
          if (!sector) return;

          await interaction.deferReply({ ephemeral: true });

          // Gather answers
          const answers: any[] = [];
          sector.questions.forEach((q: any, idx: number) => {
            const val = interaction.fields.getTextInputValue(`q_${idx}`);
            answers.push({ label: q.label, value: val });
          });

          await createTicket(interaction, sector, answers, instance);
        }
      }

      if (interaction.isButton()) {
        const customId = interaction.customId;

        if (customId.startsWith('ticket_btn:')) {
          const sectorId = customId.split(':')[1];
          let sector: any = null;
          for (const panel of instance.panels) {
            sector = panel.sectors.find((s: any) => s.id === sectorId);
            if (sector) break;
          }
          if (!sector) return;

          // If there are questions, show modal
          if (sector.questions && sector.questions.length > 0) {
            const modal = new ModalBuilder()
              .setCustomId(`ticket_modal:${sectorId}`)
              .setTitle(sector.name.substring(0, 45));

            const rows: any[] = [];
            sector.questions.forEach((q: any, qIdx: number) => {
              const textInput = new TextInputBuilder()
                .setCustomId(`q_${qIdx}`)
                .setLabel(q.label.substring(0, 45))
                .setPlaceholder(q.placeholder || "")
                .setStyle(q.isLong ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(true);
              
              const row = new ActionRowBuilder().addComponents(textInput);
              rows.push(row);
            });

            modal.addComponents(rows);
            await interaction.showModal(modal);
          } else {
            // Otherwise immediately create
            await createTicket(interaction, sector, [], instance);
          }
        }

        else if (customId.startsWith('close_ticket:')) {
          await interaction.reply({ content: "🔒 سيتم إغلاق وحذف هذه التذكرة خلال 5 ثوانٍ...", fetchReply: true }).catch(() => null);
          
          let rawLogsChannelId = botConfig.globalDiscord?.logChannelId;
          const channelTopic = interaction.channel.topic;
          if (channelTopic) {
            let sectorName = "عام";
            for (const inst of botConfig.instances) {
              for (const p of inst.panels) {
                for (const s of p.sectors) {
                  if (interaction.channel.parentId === s.categoryId) {
                     rawLogsChannelId = s.logsChannelId || rawLogsChannelId;
                     sectorName = s.name;
                  }
                }
              }
            }

            const logsChannelId = isSnowflake(rawLogsChannelId) ? rawLogsChannelId : undefined;
            if (logsChannelId) {
              const logsChannel = await interaction.guild.channels.fetch(logsChannelId).catch(() => null);
              if (logsChannel && logsChannel.isTextBased()) {
                const logEmbed = new EmbedBuilder()
                  .setTitle("🔒 تذكرة مغلقة")
                  .setColor("#EF4444")
                  .addFields(
                    { name: "صاحب التذكرة", value: `<@${channelTopic}> (${channelTopic})`, inline: true },
                    { name: "القسم", value: sectorName, inline: true },
                    { name: "تم الإغلاق بواسطة", value: `${interaction.user} (${interaction.user.id})`, inline: true }
                  )
                  .setTimestamp();
                await (logsChannel as any).send({ embeds: [logEmbed] }).catch(() => null);
              }
            }
          }

          setTimeout(async () => {
            await interaction.channel.delete().catch(() => null);
          }, 5000);
        }

        else if (customId === 'claim_ticket') {
          await interaction.reply({ content: `🙋‍♂️ تم استلام التذكرة من قبل ${interaction.user}`, allowedMentions: { parse: [] } }).catch(() => null);
          const originalMessage = interaction.message;
          const updatedComponents = originalMessage.components.map((row: any) => {
            const newRow = ActionRowBuilder.from(row);
            newRow.components.forEach((comp: any) => {
              if (comp.data.custom_id === 'claim_ticket') {
                comp.setDisabled(true);
                comp.setLabel(`مستلمة من ${interaction.user.username}`);
              }
            });
            return newRow;
          });
          await originalMessage.edit({ components: updatedComponents }).catch(() => null);
        }
      }
    } catch (err) {
      console.error("Interaction Error:", err);
    }
  }

  // API Routes
  apiRouter.get("/config", (req, res) => res.json(botConfig));

  const getOAuthRedirectUri = (req: any) => {
    if (process.env.DISCORD_REDIRECT_URI) {
      return process.env.DISCORD_REDIRECT_URI;
    }
    const host = req.get('host') || '';
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = isLocal ? 'http' : 'https';
    return `${protocol}://${host}/api/auth/callback`;
  };

  apiRouter.get("/auth/url", (req, res) => {
    const redirectUri = getOAuthRedirectUri(req);
    
    const clientId = process.env.DISCORD_CLIENT_ID || "1479915789661503699";
    
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify guilds"
    });
    
    res.json({ url: `https://discord.com/api/oauth2/authorize?${params.toString()}` });
  });

  apiRouter.get("/auth/callback", async (req, res) => {
    const { code } = req.query;
    if (!code) {
      return res.status(400).send("No code provided");
    }
    
    const redirectUri = getOAuthRedirectUri(req);
    
    const clientId = process.env.DISCORD_CLIENT_ID || "1479915789661503699";
    const clientSecret = process.env.DISCORD_CLIENT_SECRET || "fBsnnCDwv28m7PFn2FAxFq22KkK96aa-";
    
    if (!clientSecret) {
      console.warn("[OAUTH_WARNING] DISCORD_CLIENT_SECRET environment variable is missing.");
    }

    try {
      const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret || "",
          grant_type: "authorization_code",
          code: code as string,
          redirect_uri: redirectUri,
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.text();
        throw new Error(`Failed to exchange token: ${errorData}`);
      }

      const tokenData = await tokenResponse.json() as any;
      const accessToken = tokenData.access_token;

      const userResponse = await fetch("https://discord.com/api/users/@me", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!userResponse.ok) {
        throw new Error("Failed to fetch user data from Discord");
      }

      const userData = await userResponse.json() as any;

      const guildsResponse = await fetch("https://discord.com/api/users/@me/guilds", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      let isInRsServer = false;
      const rsGuildId = botConfig.globalDiscord?.guildId || "";
      const hasValidGuildId = rsGuildId && rsGuildId !== "YOUR_GUILD_ID_HERE" && isSnowflake(rsGuildId);

      if (!hasValidGuildId) {
        isInRsServer = true;
      } else if (guildsResponse.ok) {
        const userGuilds = await guildsResponse.json() as any[];
        isInRsServer = userGuilds.some(g => g.id === rsGuildId);
      }

      // Also double check if any of our active bot clients can find them in the server
      if (!isInRsServer && hasValidGuildId) {
        for (const [id, client] of botClients.entries()) {
          if (client.isReady()) {
            const guild = await client.guilds.fetch(rsGuildId).catch(() => null);
            if (guild) {
              const member = await guild.members.fetch(userData.id).catch(() => null);
              if (member) {
                isInRsServer = true;
                break;
              }
            }
          }
        }
      }

      (req.session as any).discordUser = {
        id: userData.id,
        username: userData.username,
        avatar: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : "https://i.top4top.io/p_3767lz3lr1.png",
        tag: userData.username,
        isInRsServer
      };

      res.send(`
        <html>
          <body style="font-family: sans-serif; background-color: #0d0d0d; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0;">
            <div style="text-align: center; background-color: #1a1a1a; padding: 40px; border-radius: 20px; border: 1px border-[#c5a059]">
              <h2 style="color: #c5a059; margin-bottom: 10px;">تم تسجيل الدخول بنجاح!</h2>
              <p style="color: #888;">مرحباً ${userData.username}، سيتم إغلاق هذه النافذة تلقائياً...</p>
            </div>
            <script>
              if (window.opener) {
                window.opener.postMessage({ 
                  type: 'OAUTH_AUTH_SUCCESS',
                  user: ${JSON.stringify((req.session as any).discordUser)}
                }, '*');
                window.close();
              } else {
                window.location.href = '/dashboard';
              }
            </script>
          </body>
        </html>
      `);

    } catch (error: any) {
      console.error("OAuth Exchange Error:", error);
      res.status(500).send(`
        <html>
          <body style="font-family: sans-serif; background-color: #0d0d0d; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0;">
            <div style="text-align: center; background-color: #1a1a1a; padding: 40px; border-radius: 20px; border: 1px solid #ef4444; max-width: 400px;">
              <h2 style="color: #ef4444; margin-bottom: 10px;">فشل تسجيل الدخول عبر ديسكورد</h2>
              <p style="color: #aaa; font-size: 14px;">${error.message}</p>
              <p style="color: #666; font-size: 12px; margin-top: 20px;">ستغلق النافذة تلقائياً في 4 ثوانٍ</p>
            </div>
            <script>
              setTimeout(() => {
                if (window.opener) {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_FAILURE', error: "${error.message}" }, '*');
                  window.close();
                }
              }, 4000);
            </script>
          </body>
        </html>
      `);
    }
  });

  apiRouter.get("/auth/me", (req, res) => {
    if ((req.session as any).discordUser) {
      return res.json({ loggedIn: true, user: (req.session as any).discordUser });
    }
    return res.json({ loggedIn: false });
  });

  apiRouter.post("/auth/bypass", (req, res) => {
    const { userId, username } = req.body;
    if (!userId || !isSnowflake(userId)) {
      return res.status(400).json({ error: "معرف ديسكورد غير صالح" });
    }
    
    (req.session as any).discordUser = {
      id: userId,
      username: username || "مستخدم مطور",
      avatar: "https://i.top4top.io/p_3767lz3lr1.png",
      tag: username || "مستخدم مطور",
      isInRsServer: true
    };
    
    res.json({ success: true, user: (req.session as any).discordUser });
  });

  apiRouter.post("/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  apiRouter.post("/verify-role", async (req, res) => {
    const { userId } = req.body;
    if (!userId || !isSnowflake(userId)) {
      return res.json({ hasRole: false, error: "معرف ديسكورد غير صالح" });
    }

    const targetRoleId = "1456004369358131335";

    // 1. Always allow if userId matches any instance's ownerId (safety fallback)
    const isOwner = botConfig.instances.some((inst: any) => inst.ownerId === userId);
    if (isOwner) {
      return res.json({ hasRole: true, isOwner: true });
    }

    // 2. Check if there are any active bot clients
    let readyClientCount = 0;
    let hasRole = false;
    let checked = false;

    for (const [id, client] of botClients.entries()) {
      if (client.isReady()) {
        readyClientCount++;
        const guildId = botConfig.globalDiscord?.guildId || client.guilds.cache.first()?.id;
        if (guildId) {
          const guild = await client.guilds.fetch(guildId).catch(() => null);
          if (guild) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member) {
              checked = true;
              if (member.roles.cache.has(targetRoleId)) {
                hasRole = true;
                break;
              }
            }
          }
        }
      }
    }

    if (hasRole) {
      return res.json({ hasRole: true });
    }

    if (readyClientCount === 0) {
      return res.json({ hasRole: false, error: "لا يوجد أي بوت متصل حالياً للتحقق من الرتبة. يرجى إدخال معرف ديسكورد لمالك البوت أولاً للتحكم." });
    }

    if (!checked) {
      return res.json({ hasRole: false, error: "لم يتم العثور على هذا العضو في السيرفر أو لا يمتلك الرتبة المطلوبة." });
    }

    return res.json({ hasRole: false, error: "حسابك لا يمتلك الرتبة المطلوبة للوصول لغرفة العمليات." });
  });

  apiRouter.get("/discord/data", async (req, res) => {
    const { instanceId, guildId } = req.query;
    const client = botClients.get(instanceId as string);
    if (!client?.isReady()) return res.status(400).json({ error: "البوت غير متصل" });

    try {
      let gId = (guildId as string) || botConfig.globalDiscord?.guildId;
      
      if (!isSnowflake(gId)) {
        gId = undefined;
      }

      if (!gId) {
        const cachedGuild = client.guilds.cache.first();
        if (cachedGuild) {
          gId = cachedGuild.id;
        } else {
          const guilds = await client.guilds.fetch().catch(() => null);
          gId = guilds ? (guilds.first() as any)?.id : undefined;
        }

        // Auto-save the found guildId to configuration if the current one is placeholder or empty
        if (gId && isSnowflake(gId) && (!botConfig.globalDiscord?.guildId || botConfig.globalDiscord.guildId === 'YOUR_GUILD_ID_HERE')) {
          if (!botConfig.globalDiscord) {
            botConfig.globalDiscord = {
              guildId: gId,
              adminRoleId: '',
              staffRoleId: '',
              logChannelId: '',
              ticketCategoryId: '',
              transcriptChannelId: ''
            };
          } else {
            botConfig.globalDiscord.guildId = gId;
          }
          saveConfig();
        }
      }

      if (!gId || !isSnowflake(gId)) {
        return res.json({ channels: [], roles: [] });
      }

      const guild = await client.guilds.fetch(gId).catch(() => null);
      if (!guild) {
        // Fallback: try fetching the first guild the bot is in
        const cachedGuild = client.guilds.cache.first();
        let fallbackGuild = cachedGuild ? await client.guilds.fetch(cachedGuild.id).catch(() => null) : null;
        if (!fallbackGuild) {
          const guilds = await client.guilds.fetch().catch(() => null);
          const fallbackGId = guilds ? (guilds.first() as any)?.id : undefined;
          if (fallbackGId && isSnowflake(fallbackGId)) {
            fallbackGuild = await client.guilds.fetch(fallbackGId).catch(() => null);
          }
        }
        
        if (fallbackGuild) {
          const channels = await fallbackGuild.channels.fetch().catch(() => null);
          const roles = await fallbackGuild.roles.fetch().catch(() => null);
          return res.json({
            channels: channels ? channels.filter(c => c && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildCategory)).map(c => ({ id: c!.id, name: c!.name, type: c!.type })) : [],
            roles: roles ? roles.map(r => ({ id: r.id, name: r.name })) : []
          });
        }
        return res.json({ channels: [], roles: [] });
      }

      const channels = await guild.channels.fetch().catch(() => null);
      const roles = await guild.roles.fetch().catch(() => null);

      res.json({
        channels: channels ? channels.filter(c => c && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildCategory)).map(c => ({ id: c!.id, name: c!.name, type: c!.type })) : [],
        roles: roles ? roles.map(r => ({ id: r.id, name: r.name })) : []
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  apiRouter.post("/deploy", async (req, res) => {
    const { instanceId, panelId } = req.body;
    
    const client = botClients.get(instanceId);
    if (!client?.isReady()) {
      return res.status(400).json({ error: "البوت غير متصل. يرجى تشغيل البوت أولاً ليتسنى له إرسال اللوحة." });
    }

    const instance = botConfig.instances.find(i => i.id === instanceId);
    if (!instance) {
      return res.status(404).json({ error: "لم يتم العثور على البوت" });
    }

    const panel = instance.panels.find(p => p.id === panelId);
    if (!panel) {
      return res.status(404).json({ error: "اللوحة المطلوبة غير موجودة" });
    }

    let targetChannelId = panel.channelId;
    if (!targetChannelId) {
      const firstGuild = client.guilds.cache.first();
      if (firstGuild) {
        const channels = await firstGuild.channels.fetch().catch(() => null);
        if (channels) {
          const textChannel = channels.find(c => c && c.type === ChannelType.GuildText);
          if (textChannel) {
            targetChannelId = textChannel.id;
            panel.channelId = targetChannelId;
            saveConfig();
          }
        }
      }
    }

    if (!targetChannelId) {
      return res.status(400).json({ error: "يرجى تحديد قناة لإرسال اللوحة إليها في إعدادات اللوحة وحفظ التعديلات أولاً." });
    }

    try {
      let channel = await client.channels.fetch(targetChannelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        const firstGuild = client.guilds.cache.first();
        if (firstGuild) {
          const channels = await firstGuild.channels.fetch().catch(() => null);
          if (channels) {
            const textChannel = channels.find(c => c && c.type === ChannelType.GuildText);
            if (textChannel) {
              targetChannelId = textChannel.id;
              panel.channelId = targetChannelId;
              saveConfig();
              channel = textChannel;
            }
          }
        }
      }

      if (!channel || !channel.isTextBased()) {
        return res.status(400).json({ error: "القناة المحددة غير موجودة، أو أن البوت لا يمتلك الصلاحية لرؤيتها، أو أنها ليست قناة كتابية صالحة." });
      }

      const embed = new EmbedBuilder()
        .setTitle(panel.name || "نظام التذاكر")
        .setDescription(panel.message || "يرجى الضغط على الزر المقابل لطلب الدعم الفني")
        .setColor((botConfig.app?.branding?.primaryColor || "#c5a059") as ColorResolvable);

      if (panel.logoUrl && panel.logoUrl.trim() !== "") {
        embed.setThumbnail(panel.logoUrl);
      } else if (botConfig.app?.branding?.logo) {
        embed.setThumbnail(botConfig.app.branding.logo);
      }

      if (panel.bannerUrl && panel.bannerUrl.trim() !== "") {
        embed.setImage(panel.bannerUrl);
      } else if (botConfig.app?.branding?.banner) {
        embed.setImage(botConfig.app.branding.banner);
      }

      if (botConfig.app?.branding?.footer) {
        embed.setFooter({ text: botConfig.app.branding.footer });
      }

      const rows: any[] = [];
      if (panel.sectors && panel.sectors.length > 0) {
        let currentRow = new ActionRowBuilder();
        panel.sectors.forEach((sector: any, idx: number) => {
          if (idx > 0 && idx % 5 === 0) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
          }
          const btn = new ButtonBuilder()
            .setCustomId(`ticket_btn:${sector.id}`)
            .setLabel(sector.name)
            .setStyle(ButtonStyle.Primary);
          if (sector.emoji) {
            btn.setEmoji(sector.emoji);
          }
          currentRow.addComponents(btn);
        });
        if (currentRow.components.length > 0) {
          rows.push(currentRow);
        }
      }

      await (channel as any).send({
        embeds: [embed],
        components: rows
      });

      res.json({ message: "تم نشر اللوحة بنجاح في القناة المحددة!" });
    } catch (err: any) {
      console.error("[DEPLOY_ERR]", err);
      res.status(500).json({ error: `فشل إرسال الرسالة إلى Discord. يرجى التأكد من أن التوكن صالح وأن البوت مضاف للسيرفر ولديه صلاحيات إرسال الرسائل ورؤية القناة. الخطأ: ${err.message}` });
    }
  });

  apiRouter.post("/start", async (req, res) => {
    const { instanceId } = req.body;
    await startBotInstance(instanceId);
    res.json({ message: "تم إصدار أمر للتشغيل" });
  });

  apiRouter.post("/stop", async (req, res) => {
    const { instanceId } = req.body;
    const client = botClients.get(instanceId);
    if (client) {
      await client.destroy().catch(() => null);
      botClients.delete(instanceId);
      const instance = botConfig.instances.find(i => i.id === instanceId);
      if (instance) {
        instance.status = "متوقف";
        saveConfig();
      }
    }
    res.json({ message: "تم الإيقاف" });
  });

  apiRouter.post("/instances/add", (req, res) => {
    const { name, ownerId } = req.body;
    const newInst = {
      id: "inst-" + Date.now(),
      name: name || "بوت جديد",
      token: "",
      status: "متوقف",
      panels: [],
      ownerId: ownerId || "",
      systemEmbeds: {
        alreadyHasTicket: { title: "❌ لديك تذكرة مفتوحة", description: "أغلق تذكرتك الحالية أولاً", color: "#FF0000" },
        ticketWarning: { title: "⚠️ تنبيه رسمي", description: "تم تنبيهك في {channel}\nالسبب: {reason}", color: "#FF0000" }
      }
    };
    botConfig.instances.push(newInst);
    saveConfig();
    res.json(newInst);
  });

  apiRouter.post("/instances/delete", async (req, res) => {
    const { id } = req.body;
    const client = botClients.get(id);
    if (client) {
      await client.destroy().catch(() => null);
      botClients.delete(id);
    }
    const index = botConfig.instances.findIndex(i => i.id === id);
    if (index !== -1) {
      botConfig.instances.splice(index, 1);
      saveConfig();
      return res.json({ success: true, message: "تم حذف البوت بنجاح" });
    }
    res.status(404).json({ error: "لم يتم العثور على البوت" });
  });

  apiRouter.post("/instances/update", (req, res) => {
    const { id, ...otherUpdates } = req.body;
    
    // Handle instance-specific updates if ID matches
    const inst = botConfig.instances.find(i => i.id === id);
    if (inst) {
      Object.keys(otherUpdates).forEach(key => {
        inst[key] = otherUpdates[key];
      });
      saveConfig();
      return res.json({ success: true });
    }

    // Handle global updates for any top-level key in config.json
    let updatedGlobal = false;
    for (const key in otherUpdates) {
       if (key !== 'id') {
          // If the key exists in botConfig or is a recognized global key
          if (botConfig[key] !== undefined) {
             // Deep merge or replace depending on type
             if (typeof otherUpdates[key] === 'object' && !Array.isArray(otherUpdates[key])) {
                botConfig[key] = { ...botConfig[key], ...otherUpdates[key] };
             } else {
                botConfig[key] = otherUpdates[key];
             }
             updatedGlobal = true;
          }
       }
    }

    if (updatedGlobal) {
      saveConfig();
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "لا يوجد بوت بهذا المعرف أو الحقول غير صالحة" });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  // Auto-start active bots on startup
  botConfig.instances?.forEach((inst: any) => {
    if (inst.status === "متصل" && inst.token) {
      console.log(`[AUTO_START] Starting active bot instance: ${inst.name} (${inst.id})`);
      startBotInstance(inst.id).catch(err => {
         console.error(`[AUTO_START_ERROR] Failed to start active bot ${inst.id}:`, err);
      });
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
