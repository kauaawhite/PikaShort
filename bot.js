    const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

const port = 8080;
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// Retrieve the Telegram bot token from the environment variable
const botToken = process.env.TELEGRAM_BOT_TOKEN;

// Create the Telegram bot instance
const bot = new TelegramBot(botToken, { polling: true });

// Handle /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;
  const welcomeMessage = `😇 Hello, ${username}!\n\n`
    + 'Welcome to the Pikashort URL Shortener Bot!\n'
    + 'You can use this bot to shorten URLs using the Indishort.live api service.\n\n'
    + 'To shorten a URL, just type or paste the URL directly in the chat, and the bot will provide you with the shortened URL.\n\n'
    + 'If you haven\'t set your Indishort API token yet, use the command:\n/setapi YOUR_Pikashort/Smallshorturl_API_TOKEN\n\n'
    + 'How To Use Me 👇👇 \n\n'
  + '✅1. Got To https://smallshorturl.myvippanel.shop & Complete Your Registration.\n\n'
  + '✅2. Then Copy Your API Key from here https://smallshorturl.myvippanel.shop/member/tools/api Copy Your API Only. \n\n'
  + '✅3. Then add your API using command /setapi \n\n' 
  + 'Example: /api c49399f821fc020161bc2a31475ec59f35ae5b4\n\n'
  + '⚠️ You must have to send link with https:// or http://\n\n'
  + 'Made with ❤️ By: @Sahilkhan0785';
  + '**Now, go ahead and try it out!**';

  bot.sendMessage(chatId, welcomeMessage);
});

// Command: /setapi
bot.onText(/\/setapi (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userToken = match[1].trim();

  // Save the user's AdlinkFly API token to the database
  saveUserToken(chatId, userToken);

  const response = `Your Pikashort API token set successfully. ✅️✅️ Your token is: ${userToken}`;
  bot.sendMessage(chatId, response);
});

// Listen for any message (not just commands)
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Check if message contains text or forwarded content
  if (msg.text || msg.caption) {
    const text = msg.text || msg.caption;
    const links = extractLinks(text);

    if (links.length > 0) {
      const shortenedLinks = await shortenMultipleLinks(chatId, links);

      // Replace original links in the text
      const updatedText = replaceLinksInText(text, links, shortenedLinks);

      bot.sendMessage(chatId, updatedText, {
        reply_to_message_id: msg.message_id,
      });
    }
  }

  // If message has media with caption, handle it
  if (msg.photo || msg.video || msg.document) {
    const caption = msg.caption || '';
    const links = extractLinks(caption);

    if (links.length > 0) {
      const shortenedLinks = await shortenMultipleLinks(chatId, links);

      // Replace original links in the caption
      const updatedCaption = replaceLinksInText(caption, links, shortenedLinks);

      bot.sendMessage(chatId, updatedCaption, {
        reply_to_message_id: msg.message_id,
      });
    }
  }
});

// Function to extract URLs from a given text
function extractLinks(text) {
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})([^\s]*)/g;
  const links = [...text.matchAll(urlRegex)].map(match => match[0]);
  return links;
}

// Function to replace original links with shortened links in the text
function replaceLinksInText(text, originalLinks, shortenedLinks) {
  let updatedText = text;
  originalLinks.forEach((link, index) => {
    updatedText = updatedText.replace(link, shortenedLinks[index]);
  });
  return updatedText;
}

// Function to shorten multiple links
async function shortenMultipleLinks(chatId, links) {
  const shortenedLinks = [];
  for (const link of links) {
    const shortenedLink = await shortenUrl(chatId, link);
    shortenedLinks.push(shortenedLink || link); // Use original link if shortening fails
  }
  return shortenedLinks;
}

// Function to shorten a single URL
async function shortenUrl(chatId, url) {
  const adlinkflyToken = getUserToken(chatId);

  if (!adlinkflyToken) {
    bot.sendMessage(chatId, 'Please set up 🎃 your Pikashort/Smallshorturl API token first. 🔮 Use the command: /setapi YOUR_Pikashort/Smallshorturl_API_TOKEN');
    return null;
  }

  try {
    const apiUrl = `https://smallshorturl.myvippanel.shop/api?api=${adlinkflyToken}&url=${encodeURIComponent(url)}`;
    const response = await axios.get(apiUrl);
    return response.data.shortenedUrl;
  } catch (error) {
    console.error('Shorten URL Error:', error);
    return null;
  }
}

// Function to save user's AdlinkFly API token
function saveUserToken(chatId, token) {
  const dbData = getDatabaseData();
  dbData[chatId] = token;
  fs.writeFileSync('./src/database.json', JSON.stringify(dbData, null, 2));
}

// Function to retrieve user's AdlinkFly API token
function getUserToken(chatId) {
  const dbData = getDatabaseData();
  return dbData[chatId];
}

// Function to read the database file
function getDatabaseData() {
  try {
    return JSON.parse(fs.readFileSync('./src/database.json', 'utf8'));
  } catch (error) {
    return {};
  }
}
