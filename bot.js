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
      timeout: 120
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
        let file_size=null;
    
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
          file_size=post.video.file_size;
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
            file_size,
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





    const userResults = new Map(); // Store user-specific results
    const userSearchStates = new Map(); // Store search states for deep linking
    let botUsername = ''; // Store bot username
    
    // Initialize bot username when the bot starts
    bot.getMe().then(botInfo => {
      botUsername = botInfo.username;
      console.log(`🤖 Bot initialized as @${botUsername}`);
    }).catch(error => {
      console.error('Error getting bot info:', error);
    });
    
    async function getPostsByName(query) {
      try {
        // Ensure query is a string and handle null/undefined cases
        const searchQuery = String(query || '').trim();
        
        if (!searchQuery) {
          return [];
        }
    
        const db = client.db(dbName);
        const collection = db.collection('posts');
        
        const posts = await collection.find({
          file_name: { $regex: searchQuery, $options: 'i' }
        }).toArray();
    
        return posts.map(post => ({ ...post, query: searchQuery }));
      } catch (error) {
        console.error('Error fetching posts:', error);
        return [];
      }
    }
    
    function formatFileSize(bytes) {
      if (!bytes || isNaN(bytes)) return '0 B';
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
    }
    
    function generateKeyboard(items, currentPage, pageSize, query, userId, isGroup = false) {
      const totalItems = items.length;
      const totalPages = Math.ceil(totalItems / pageSize);
      const startIndex = (currentPage - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, totalItems);
      const pageItems = items.slice(startIndex, endIndex);
    
      // Generate file buttons with user ID in callback data
      const keyboard = pageItems.map((item, index) => {
        const displayName = item.file_name.length > 35 
          ? item.file_name.substring(0, 32) + '...'
          : item.file_name;
        
        const fileSize = formatFileSize(item.file_size);
        const callbackData = `d:${(item.file_id || item.file_ref).slice(-20)}:${userId}`;
        
        return [{
          text: `📥 ${index + 1}.[${fileSize}] ${displayName}\n `,
          callback_data: callbackData
        }];
      });
    
      // Add pagination controls with user ID
      const paginationRow = [];
      
      if (currentPage > 1) {
        paginationRow.push({
          text: '⏮ First',
          callback_data: `page:1:${query}:${userId}`
        });
      }
    
      if (currentPage > 1) {
        paginationRow.push({
          text: '◀️ Prev',
          callback_data: `page:${currentPage - 1}:${query}:${userId}`
        });
      }
    
      paginationRow.push({
        text: `📄 ${currentPage}/${totalPages}`,
        callback_data: 'noop'
      });
    
      if (currentPage < totalPages) {
        paginationRow.push({
          text: 'Next ▶️',
          callback_data: `page:${currentPage + 1}:${query}:${userId}`
        });
      }
    
      if (currentPage < totalPages) {
        paginationRow.push({
          text: 'Last ⏭',
          callback_data: `page:${totalPages}:${query}:${userId}`
        });
      }
    
      if (paginationRow.length > 0) {
        keyboard.push(paginationRow);
      }
    
      keyboard.push([{
        text: `📊 ${totalItems} results found`,
        callback_data: 'noop'
      }]);
    
      return keyboard;
    }
    
    // Message handler with group chat support
    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const userQuery = msg.text?.trim();
    
      if (!userQuery || !userQuery.startsWith('/')) {
        try {
          const statusMessage = await bot.sendMessage(chatId, '🔍 Searching...');
          const posts = await getPostsByName(userQuery);
    
          if (posts.length > 0) {
            // Store results for this specific user
            userResults.set(`${userId}_${userQuery}`, posts);
            
            const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
            const keyboard = generateKeyboard(posts, 1, 10, userQuery, userId, isGroup);
            
            await bot.editMessageText(
              `🎯 <a href="tg://user?id=${userId}">${msg.from.first_name}</a>'s results for "${userQuery}":`,
              {
                chat_id: chatId,
                message_id: statusMessage.message_id,
                reply_markup: { inline_keyboard: keyboard },
                parse_mode: 'HTML'
              }
            );
          } else {
            await bot.editMessageText(
              '❌ No results found. Please try a different search term.',
              {
                chat_id: chatId,
                message_id: statusMessage.message_id
              }
            );
          }
        } catch (error) {
          console.error('Search error:', error);
          await bot.sendMessage(
            chatId,
            '⚠️ An error occurred while searching. Please try again later.'
          );
        }
        return;
      }
    
      // Handle /start command
      if (userQuery === '/start') {
        await bot.sendMessage(
          chatId,
          '👋 Welcome! Send me a search query to find files.'
        );
      }
    });
    
    // Callback query handler with direct file sending
    bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;
      const data = callbackQuery.data;
      const userId = callbackQuery.from.id;
      const isGroup = callbackQuery.message.chat.type === 'group' || 
                     callbackQuery.message.chat.type === 'supergroup';
    
      try {
        if (data === 'noop') {
          await bot.answerCallbackQuery(callbackQuery.id);
          return;
        }
    
        if (data.startsWith('page:')) {
          const [_, page, query, requestUserId] = data.split(':');
          
          // Verify user permission
          if (userId.toString() !== requestUserId) {
            await bot.answerCallbackQuery(callbackQuery.id, {
              text: '⚠️ These are not your search results',
              show_alert: true
            });
            return;
          }
    
          const currentPage = parseInt(page, 10);
          const userKey = `${userId}_${query}`;
          const posts = userResults.get(userKey) || await getPostsByName(query);
    
          if (posts.length > 0) {
            const keyboard = generateKeyboard(posts, currentPage, 10, query, userId, isGroup);
            
            await bot.editMessageText(
              `🎯 <a href="tg://user?id=${userId}">${callbackQuery.from.first_name}</a>'s results for "${query}":`,
              {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: keyboard },
                parse_mode: 'HTML'
              }
            );
          }
          
          await bot.answerCallbackQuery(callbackQuery.id);
        } else if (data.startsWith('d:')) {
          const [_, fileId, requestUserId] = data.split(':');
        
          // Verify user permission
          if (userId.toString() !== requestUserId) {
            await bot.answerCallbackQuery(callbackQuery.id, {
              text: '⚠️ You cannot access this file as it was requested by another user',
              show_alert: true
            });
            return;
          }
        
          const fileDetails = await getFileDetailsFromDatabase(fileId);
        
          if (fileDetails?.file_id) {
            try {
              if (isGroup) {
                // Send the file directly to the user's private chat
                await bot.sendDocument(userId, fileDetails.file_id, {
                  caption: `📁 ${fileDetails.file_name}\n\nThis file was requested in the group.`
                });
        
                // Notify the user privately without altering the group message
                await bot.answerCallbackQuery(callbackQuery.id, {
                  text: '📤 The file has been sent to your private chat',
                  show_alert: true
                });
              } else {
                // For private chats, send the file directly
                await bot.answerCallbackQuery(callbackQuery.id, {
                  text: '📤 Sending file...'
                });
        
                await bot.sendDocument(chatId, fileDetails.file_id, {
                  caption: `📁 ${fileDetails.file_name}`
                });
              }
            } catch (error) {
              console.error('Error sending to private chat:', error);
              if (error.code === 403) {
                await bot.answerCallbackQuery(callbackQuery.id, {
                  text: '⚠️ Please start a private chat with me first: @' + botUsername,
                  show_alert: true
                });
              } else {
                await bot.answerCallbackQuery(callbackQuery.id, {
                  text: '⚠️ Failed to send file. Please try again',
                  show_alert: true
                });
              }
            }
          } else {
            await bot.answerCallbackQuery(callbackQuery.id, {
              text: '❌ File not found',
              show_alert: true
            });
          }
        }
        
      } catch (error) {
        console.error('Callback query error:', error);
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: '⚠️ An error occurred',
          show_alert: true
        });
      }
    });
    
    async function getFileDetailsFromDatabase(shortId) {
      try {
        const db = client.db(dbName);
        const collection = db.collection('posts');
        
        const post = await collection.findOne({
          $or: [
            { file_id: { $regex: shortId + '$' } },
            { file_ref: { $regex: shortId + '$' } }
          ]
        });
    
        if (!post) return null;
    
        return {
          file_id: post.file_id || post.file_ref,
          file_name: post.file_name || 'Unknown File'
        };
      } catch (error) {
        console.error('Database query error:', error);
        return null;
      }
    }

    

    
    
    bot.on("polling_error", handler.botError);
    bot.on("error", handler.botError);

    console.info(`\u{1F41D} Bot started successfully`);
  })
  .catch(error => console.error("Mongoose connection error:", error));
