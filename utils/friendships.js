const FriendRequest = require("../models/FriendRequest");
const User = require("../models/User");

async function areFriends(firstUserId, secondUserId) {
  if (String(firstUserId) === String(secondUserId)) return false;

  const relationship = await FriendRequest.exists({
    status: "accepted",
    $or: [
      { sender: firstUserId, recipient: secondUserId },
      { sender: secondUserId, recipient: firstUserId },
    ],
  });

  return Boolean(relationship);
}

async function isBlockedBetween(firstUserId, secondUserId) {
  const blocked = await User.exists({
    $or: [
      { _id: firstUserId, blocking: secondUserId },
      { _id: secondUserId, blocking: firstUserId },
    ],
  });
  return Boolean(blocked);
}

module.exports = { areFriends, isBlockedBetween };
