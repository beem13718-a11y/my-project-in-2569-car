require('dotenv').config();


const lineConfig = {

  notifyToken: process.env.LINE_NOTIFY_TOKEN || null,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || null
};

module.exports = lineConfig;
