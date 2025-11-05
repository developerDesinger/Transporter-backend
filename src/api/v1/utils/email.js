const sgMail = require("@sendgrid/mail");
require("dotenv").config(); // Load environment variables

// Set SendGrid API Key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const sendEmail = async (options) => {
  // Validate recipient email
  if (!options.email) {
    console.error("❌ Error: Recipient email is missing.");
    return;
  }

  // Validate OTP
  if (!options.otp) {
    console.error("❌ Error: No OTP provided.");
    return;
  }

  // Email Verification Template
  const htmlTemplate = `  
 <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
    <img src="https://booking-bot-frontend.vercel.app/images/Group%201410088281.png" alt="Booking Bot Logo" style="max-width: 150px;">
  </div>
  <div style="background-color: #ffffff; padding: 20px; text-align: center;">
    <p>Hello,</p>
    <p>Your One-Time Password (OTP) for verification is:</p>
    <p style="font-size: 24px; font-weight: bold; color: #50483f; margin: 10px 0;">${options.otp}</p>
    <p>Please enter this code to complete your verification process.</p>
  </div>
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
    <p>If you did not request this OTP, please ignore this email.</p>
    <p>For any assistance, contact us at <a href="mailto:support@bookingbot.com" style="color: #007bff; text-decoration: none;">support@bookingbot.com</a>.</p>
    <p>Best regards,<br/>The Booking Bot Team</p>
  </div>
</div>
`;

  // Email options
  const mailOptions = {
    to: options.email,
    from: "tericalomnick@gmail.com", // Must be a verified sender email in SendGrid
    subject: options.subject || "Your OTP Code",
    html: htmlTemplate,
  };

  try {
    await sgMail.send(mailOptions);
    console.log(`✅ Email sent successfully to: ${options.email}`);
  } catch (error) {
    console.error(
      "❌ Error sending email:",
      error.response ? error.response.body : error
    );
  }
};

const sendForgotPasswordEmail = async (options) => {
  // Validate recipient email
  if (!options.email) {
    console.error("❌ Error: Recipient email is missing.");
    return;
  }

  // Validate OTP or Reset Token
  if (!options.otp) {
    console.error("❌ Error: No OTP provided.");
    return;
  }

  // Forgot Password Email Template
  const htmlTemplate = `  
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
    <img src="https://booking-bot-frontend.vercel.app/images/Group%201410088281.png" alt="Booking Bot Logo" style="max-width: 150px;">
  </div>
  <div style="background-color: #ffffff; padding: 20px; text-align: center;">
    <p>Hello,</p>
    <p>We received a request to reset your password. Use the OTP below to reset your password:</p>
    <p style="font-size: 24px; font-weight: bold; color: #50483f; margin: 10px 0;">${options.otp}</p>
    <p>If you did not request a password reset, you can ignore this email. Your password will remain unchanged.</p>
  </div>
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
    <p>For any assistance, contact us at <a href="mailto:support@bookingbot.com" style="color: #007bff; text-decoration: none;">support@bookingbot.com</a>.</p>
    <p>Best regards,<br/>The Booking Bot Team</p>
  </div>
</div>
`;

  // Email options
  const mailOptions = {
    to: options.email,
    from: "tericalomnick@gmail.com", // Must be a verified sender email in SendGrid
    subject: options.subject || "Reset Your Password",
    html: htmlTemplate,
  };

  try {
    await sgMail.send(mailOptions);
    console.log(
      `✅ Forgot password email sent successfully to: ${options.email}`
    );
  } catch (error) {
    console.error(
      "❌ Error sending email:",
      error.response ? error.response.body : error
    );
  }
};

module.exports = { sendEmail, sendForgotPasswordEmail };

// module.exports = sendEmail;
