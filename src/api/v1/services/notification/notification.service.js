const admin = require("firebase-admin");
const { getMessaging } = require("firebase-admin/messaging");
const Notification = require("../../Models/Notification.js");
const serviceAccount = require("../../../v1/dev-data/serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

class NotificationService {
  static messaging = getMessaging();

  static async sendNotification(payload) {
    console.log("PAYLOAD", payload);
    try {
      const messageTitle = payload.title;
      const messageBody = payload.body;
      const fcmTokens = payload.fcmToken;

      // console.log("Payload : ", payload);

      const message = {
        notification: {
          title: messageTitle,
          body: messageBody,
        },
        data: {
          event: payload.event,
          id: payload.id.toString(),
          role: payload.role,
        },
        android: {
          notification: {
            sound: "default", // Default notification sound for Android
          },
        },
        apns: {
          payload: {
            aps: {
              sound: "default", // Default notification sound for iOS
            },
          },
        },
      };

      console.log("MMMMMMMMMMMMMMMMMMSSSSSSSSSSSSSSSSSSSSSSSSSSSS", message);

      if (fcmTokens.length === 1) {
        // If there's only one token, use the single token approach
        message.token = fcmTokens[0];

        console.log("Single FCM token message body: ", message);
        await NotificationService.messaging
          .send(message)
          .then((response) => {
            console.log("Success", response);
          })
          .catch((error) => {
            console.error("Error in sending FCM token", error.message);
          });
      } else if (fcmTokens.length > 1) {
        // If there are multiple tokens, use the tokens array approach
        message.tokens = fcmTokens;

        console.log("Array of FCM token message body: ", message);
        NotificationService.messaging
          .sendEachForMulticast(message)
          .then((response) => {
            if (response.failureCount > 0) {
              const failedTokens = [];
              response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                  failedTokens.push(fcmTokens[idx]);
                }
              });
              console.log(
                "List of tokens that caused failures: ",
                failedTokens
              );
            }
          });
      }

      if (
        payload.event != "AppointmentReminder1" ||
        payload.event != "AppointmentReminder12" ||
        payload.event != "AppointmentReminder24" ||
        payload.event != "StoryNotification"
      ) {
        // Create a new notification
        const notification = await Notification.create({
          title: messageTitle,
          body: messageBody,
          status: payload.event,
          role: payload.role,
          id: payload.id,
        });

        if (notification) {
          console.log("Notification saved successfully.");
        } else {
          console.log("Notification not saved");
        }
      }
    } catch (error) {
      console.error("Error in sending FCM token", error.message);
    }
  }
}

module.exports = NotificationService;
