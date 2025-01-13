require('dotenv').config();
const TelegramBot = require('telegram-bot-api');
const Post = require('../models/post');

const bot = new TelegramBot({ token: process.env.BOT_TOKEN });

bot.on('update', async (update) => {
  if (update.channel_post) {
    const post = update.channel_post;

    let file_ref = null;
    let file_name = null;
    let file_type = null;
    let mime_type = null;

    if (post.document) {
      file_ref = post.document.file_id;
      file_name = post.document.file_name;
      file_type = 'document';
      mime_type = post.document.mime_type;
    } else if (post.photo) {
      file_ref = post.photo[post.photo.length - 1].file_id; // Highest resolution
      file_type = 'photo';
    } else if (post.video) {
      file_ref = post.video.file_id;
      file_type = 'video';
      mime_type = post.video.mime_type;
    } else if (post.audio) {
      file_ref = post.audio.file_id;
      file_type = 'audio';
      mime_type = post.audio.mime_type;
    }

    try {
      const newPost = new Post({
        message_id: post.message_id,
        text: post.text || '',
        file_ref,
        file_name,
        file_type,
        mime_type,
        channel_id: post.chat.id,
        date: new Date(post.date * 1000),
      });

      await newPost.save();
      console.log(`Saved post ${post.message_id}`);
    } catch (error) {
      if (error.code === 11000) {
        console.log(`Post ${post.message_id} already exists.`);
      } else {
        console.error('Error saving post:', error);
      }
    }
  }
});

module.exports = bot;
