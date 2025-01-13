// models/Post.js
const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
  message_id: { type: Number, required: true, unique: true },
  text: { type: String, default: '' },
  file_id:{type: String,default:'' },
  file_ref: { type: String },
  file_name: { type: String },
  file_type: { type: String },
  mime_type: { type: String },
  channel_id: { type: String, required: true },
  date: { type: Date, required: true },
}, { collection: 'posts' }); // Explicitly specify the collection name

const Post = mongoose.model('Post', PostSchema);

module.exports = Post;
