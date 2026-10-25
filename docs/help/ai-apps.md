---
title: Connect AI apps
roles: [system_admin, company_admin, aims_guide, team_member]
---

# Connect AI apps

Use AiMS HQ inside an AI app such as Claude, ChatGPT or Grok Bot, so it can read your AiMS work and add commitments, issues and measure values for you, as you.

Aimee is built into AiMS HQ and needs no setup. An AI app is a separate app you use outside AiMS. You connect it once, and from then on it can work with AiMS for you, seeing only what you can see. You can disconnect it at any time from your profile.

::: feature ai_apps_off
## AI apps are switched off for your company

Your company has AI apps switched off, so you can't connect one yet. Ask your company admin: they can switch them on in your company's settings in AiMS HQ.
:::

::: feature outside_assistants
## Claude (web and desktop)

### Connect Claude

1. Copy your AiMS HQ server address: `{{mcp_address}}`
2. In Claude, open **Customize**, then **Connectors**.
3. Click **+ Add**, then **Add custom connector**.
4. Name it **AiMS HQ**, paste the address, and click **Continue**, then **Add**.
5. Click **Connect** beside AiMS HQ. Sign in to AiMS HQ as you, read what Claude will be able to do, and click **Allow**.

Claude on the web and the Claude desktop app share your connectors, so you only connect once. On a Claude Team or Enterprise plan, an owner adds the connector for everyone under **Organization settings**, then **Connectors**, and you click **Connect** on it.

### Keep Claude asking before it adds anything

Claude asks before it adds a commitment, issue or measure value. Choose **Allow once** each time, so nothing is added without you seeing it first. Don't choose **Allow always** for the add tools. Reading your work doesn't need asking.

### Try this first in Claude

Start a new chat and ask: *"What are my open commitments in AiMS?"* Then try: *"Add a commitment in AiMS to send the board pack by Friday."* Claude shows you what it will add and asks first.

### Disconnect Claude

On your AiMS HQ profile, under **Your connected AI apps**, click **Disconnect** beside Claude. It stops reaching AiMS at once. To remove it from Claude too, open **Customize**, then **Connectors**, and click **Remove** beside AiMS HQ.

### If Claude doesn't connect

- **"This AI app isn't approved for AiMS".** Add the connector from Claude itself, at claude.ai or in the Claude desktop app, using the address above. Other apps and tools aren't approved.
- **Claude can't reach AiMS, or the sign-in never appears.** Check the address is exactly `{{mcp_address}}`, with nothing added at the end. Remove the connector and add it again.
- **Claude says AI apps are switched off for your company.** Ask your company admin to switch them on in your company's settings in AiMS HQ.

## ChatGPT

### Connect ChatGPT

1. Copy your AiMS HQ server address: `{{mcp_address}}`
2. In ChatGPT on the web, open **Settings** and turn on **Developer mode**. It's under **Apps**, then **Advanced settings** (on some accounts it's under **Security and login**).
3. Create a new app: **Create** on the **Apps** page (some accounts call this page **Plugins**).
4. Name it **AiMS HQ**, paste the address as the server URL, choose **OAuth** for authentication, and create it.
5. Sign in to AiMS HQ as you, read what ChatGPT will be able to do, and click **Allow**.

Developer mode is on the web only, for Plus, Pro, Business, Enterprise and Edu accounts. On a Business, Enterprise or Edu workspace, a workspace admin may need to allow it first.

### Keep ChatGPT asking before it adds anything

ChatGPT asks before it adds a commitment, issue or measure value. Approve each one when you've checked it, rather than telling ChatGPT to remember your approval for the rest of the chat. Reading your work doesn't need asking.

### Try this first in ChatGPT

Start a new chat, choose **AiMS HQ** from the tools, and ask: *"What are my open commitments in AiMS?"* Then try: *"Add a commitment in AiMS to send the board pack by Friday."* ChatGPT shows you what it will add and asks first.

### Disconnect ChatGPT

On your AiMS HQ profile, under **Your connected AI apps**, click **Disconnect** beside ChatGPT. It stops reaching AiMS at once. To remove it from ChatGPT too, delete the AiMS HQ app in ChatGPT's settings.

### If ChatGPT doesn't connect

- **There's no way to create an app.** Developer mode is off, or your plan doesn't include it. Turn it on in **Settings**, or ask your workspace admin.
- **"This AI app isn't approved for AiMS".** Create the app from ChatGPT on the web at chatgpt.com, using the address above. Other apps and tools aren't approved.
- **ChatGPT says AI apps are switched off for your company.** Ask your company admin to switch them on in your company's settings in AiMS HQ.

## Grok Bot

### Connect Grok Bot

1. Copy your AiMS HQ server address: `{{mcp_address}}`
2. In Grok, open **Connectors** (grok.com/connectors), click **New Connector**, then choose **Custom**.
3. Paste the address as the server URL and continue.
4. Sign in to AiMS HQ as you, read what Grok Bot will be able to do, and click **Allow**.

On a Grok Business or Enterprise plan, a team admin may need to add the connector first.

The AiMS page may say Grok Bot returns to **a program on this computer**. That's normal when you're connecting from the Grok Bot app. Only click **Allow** if you started connecting Grok Bot yourself, on that computer, just now. If you didn't, click **Decline**.

### Try this first in Grok Bot

Ask: *"What are my open commitments in AiMS?"* Then try: *"Add a commitment in AiMS to send the board pack by Friday."* If Grok Bot adds it without showing you first, check the new commitment in AiMS.

### Disconnect Grok Bot

On your AiMS HQ profile, under **Your connected AI apps**, click **Disconnect** beside Grok Bot. It stops reaching AiMS at once. To remove it from Grok too, delete the AiMS HQ connector there.

### If Grok Bot doesn't connect

- **"This AI app isn't approved for AiMS".** Add the connector from Grok itself, using the address above.
- **The sign-in fails, or calls fail after connecting.** Grok Bot has some open sign-in problems of its own. Remove the connector, add it again, and if it still fails, tell AiMS what Grok showed.
- **Grok Bot says AI apps are switched off for your company.** Ask your company admin to switch them on in your company's settings in AiMS HQ.
:::
