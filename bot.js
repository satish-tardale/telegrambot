require("dotenv").config();
const mongoose = require("mongoose");
const axios = require('axios');
const TelegramBot = require("node-telegram-bot-api");
const { MongoClient,BSON,ObjectId } = require('mongodb');
const { TelegramClient } = require('telegram');
const input = require('input');
const { StringSession } = require('telegram/sessions');
const base64url = require('base64url');
const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');
const { ceil } = Math;
const express = require('express');
const app = express();
const postRoutes = require('./routes/post');
const validator = require('validator');
const handleCallbackQuery = require('./handlers/movie-callback');

// Usage


app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const env = process.env;
const config = require("./config");
const command = require("./commands");
const handler = require("./handlers");
const Post = require('./models/post');

const TOKEN = env.BOT_TOKEN;
const bot = new TelegramBot(TOKEN, {
  polling: {
    autoStart: true,
    params: {
      timeout: 60
    }
  }
});// Declare the bot once here

const apiId = Number(process.env.API_ID || '21559494'); // Ensure it's a number
const apiHash = process.env.API_HASH; // Replace with your API Hash

const client = new MongoClient(env.MONGODB_URI, { useUnifiedTopology: true, useNewUrlParser: true });
const dbName = "Cluster0";
// Bot commands and handlers
mongoose.connect(env.MONGODB_URI, config.mongodb)
  .then(() => {
    console.log("Connected to MongoDB!");

    // Register bot commands here
    bot.onText(/\/start/, command.start(bot));
    bot.onText(/about$/i, command.about(bot));
    bot.onText(/search$/i, command.search(bot));
    bot.onText(/settings$/i, command.settings(bot));
    bot.onText(/\/keyboard/, command.keyboard(bot));
    bot.onText(/(?<provider>(Movie|Music|Torrent|Anime)$)/, command.list(bot));

  
    const backupChannelId = process.env.BACKUP_CHANNEL_ID; // Ensure this is numeric (e.g., -1001234567890)

    // Verify BACKUP_CHANNEL_ID
    if (!backupChannelId) {
      console.error("Error: BACKUP_CHANNEL_ID is not set in the .env file.");
      process.exit(1); // Stop the bot if this value is missing
    }
    
    bot.on('channel_post', async (post) => {
      console.log("Received a channel post:", post);
    
      // Check if the post is from the backup channel
      if (post.chat.id.toString() === backupChannelId) {
        console.log("New post received in backup channel:", post.message_id);
        let file_id=null;
        let file_ref = null;
        let file_name = null;
        let file_type = null;
        let mime_type = null;
    
        // Determine file details based on the post type
        if (post.document) {
          file_ref = post.document.file_id;
          file_name = post.document.file_name;
          file_type = 'document';
          mime_type = post.document.mime_type;
        } else if (post.photo) {
          file_ref = post.photo[post.photo.length - 1].file_id; // Highest resolution
          file_type = 'photo';
        } else if (post.video) {
          file_id=post.video.file_id;
          file_ref = post.video.file_id;
          file_type = 'video';
          file_name=post.video.file_name;
          mime_type = post.video.mime_type;
        } else if (post.audio) {
          file_ref = post.audio.file_id;
          file_type = 'audio';
          file_name=post.audio.file_name;
          mime_type = post.audio.mime_type;
        }
    
        // Save the post to the database
        try {
          const newPost = new Post({
            message_id: post.message_id,
            text: post.caption || '',
            file_id,
            file_ref,
            file_name,
            file_type,
            mime_type,
            channel_id: post.chat.id,
            date: new Date(post.date * 1000),
          });
          const db=client.db(dbName);
          const collection = db.collection('posts');
          const data=collection.insertOne(newPost);         
          
          console.log(`Saved post ${data} to the database.`);
        } catch (error) {
          if (error.code === 11000) {
            console.log(`Post ${post.message_id} already exists.`);
          } else {
            console.error('Error saving post:', error);
          }
        }
      } else {
        console.log("Post is not from the backup channel.");
      }
    });
    
    // Log unexpected updates (for debugging)
    bot.on('update', (update) => {
      console.log("Unhandled update:", update);
    });



//user provide link
const getPostsByName = async (query) => {
  const db = client.db(dbName);
  const collection = db.collection('posts');
  return await collection.find({ file_name: { $regex: query, $options: "i" } }).toArray();
};

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userQuery = msg.text;

  try {
    const posts = await getPostsByName(userQuery);

    if (posts && posts.length > 0) {
      // Send each file as a separate message with a single button
      for (const post of posts) {
        const fileId = post.file_id || post.file_ref;
        const fileName = post.file_name;

        if (!fileId || !fileName) continue;

        // Create a simple message with file name and a download button
        await bot.sendMessage(chatId, `📁 ${fileName}`, {
          reply_markup: {
            inline_keyboard: [[
              { text: '📥 Download', callback_data: `d:${fileId.slice(-20)}` } // Added colon to match the check
            ]]
          }
        });
      }
    } else {
      await bot.sendMessage(chatId, "No files found matching your query.");
    }
  } catch (error) {
    console.error("Error processing message:", error);
    await bot.sendMessage(chatId, "Sorry, an error occurred while processing your request.");
  }
});

bot.on('callback_query', async (callbackQuery) => {
  try {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    
    // Check if it's a download request
    if (data.startsWith('d:')) {
      const shortFileId = data.slice(2); // Remove 'd:' prefix
      const fullFileId = await getFullFileIdFromDatabase(shortFileId);
      
      if (fullFileId) {
        await bot.sendDocument(chatId, fullFileId);
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Downloading..." });
      } else {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "File not found" });
      }
    } else {
      await bot.answerCallbackQuery(callbackQuery.id, { text: "Invalid request" });
    }
  } catch (error) {
    console.error("Error in callback query:", error);
    await bot.answerCallbackQuery(callbackQuery.id, { text: "Download failed" });
  }
});

const getFullFileIdFromDatabase = async (shortId) => {
  try {
    const db = client.db(dbName);
    const collection = db.collection('posts');
    
    const post = await collection.findOne({
      $or: [
        { file_id: { $regex: shortId + '$' } }, // Match the end of file_id
        { file_ref: { $regex: shortId + '$' } } // Match the end of file_ref
      ]
    });

    return post ? post.file_id || post.file_ref : null;
  } catch (error) {
    console.error("Error retrieving file ID:", error);
    return null;
  }
};








    

    
    
    bot.on("polling_error", handler.botError);
    bot.on("error", handler.botError);

    console.info(`\u{1F41D} Bot started successfully`);
  })
  .catch(error => console.error("Mongoose connection error:", error));
