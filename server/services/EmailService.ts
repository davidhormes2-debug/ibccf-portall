import nodemailer from 'nodemailer';

const ZOHO_EMAIL = 'Support@Ibcrecoverycommunity.org';
const ZOHO_SMTP_HOST = 'smtp.zoho.com';
const ZOHO_SMTP_PORT = 465;

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  private getTransporter(): nodemailer.Transporter {
    if (!this.transporter) {
      const password = process.env.ZOHO_SMTP_PASSWORD;
      
      if (!password) {
        throw new Error('ZOHO_SMTP_PASSWORD environment variable is not set');
      }

      this.transporter = nodemailer.createTransport({
        host: ZOHO_SMTP_HOST,
        port: ZOHO_SMTP_PORT,
        secure: true,
        auth: {
          user: ZOHO_EMAIL,
          pass: password,
        },
      });
    }
    return this.transporter;
  }

  async sendKeyRequestConfirmation(
    toEmail: string,
    userName: string,
    requestId: string
  ): Promise<boolean> {
    try {
      const transporter = this.getTransporter();
      
      await transporter.sendMail({
        from: `"IBCCF Support" <${ZOHO_EMAIL}>`,
        to: toEmail,
        subject: 'Access Key Request Received - IBCCF',
        html: `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #004182 0%, #004AB3 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">IBCCF</h1>
              <p style="color: rgba(255,255,255,0.8); margin: 10px 0 0 0;">International Blockchain Community Complaints Forum</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
              <h2 style="color: #004182; margin-top: 0;">Hello ${userName},</h2>
              
              <p style="color: #333; line-height: 1.6;">
                Thank you for submitting your access key request. Your request has been received and is currently under review by our security team.
              </p>
              
              <div style="background: white; border: 2px solid #004182; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
                <p style="color: #666; margin: 0 0 10px 0; font-size: 14px;">Your Request ID:</p>
                <p style="color: #004182; font-size: 28px; font-weight: bold; margin: 0; font-family: monospace;">${requestId}</p>
              </div>
              
              <p style="color: #333; line-height: 1.6;">
                <strong>Important:</strong> Please save this Request ID. You will need it to check the status of your request and retrieve your access key once approved.
              </p>
              
              <p style="color: #333; line-height: 1.6;">
                Processing typically takes 1-3 business days. You can check your request status anytime at our portal.
              </p>
              
              <hr style="border: none; border-top: 1px solid #e9ecef; margin: 25px 0;">
              
              <p style="color: #666; font-size: 13px; margin-bottom: 0;">
                If you did not submit this request, please disregard this email.
              </p>
            </div>
            
            <div style="background: #004182; padding: 20px; border-radius: 0 0 10px 10px; text-align: center;">
              <p style="color: rgba(255,255,255,0.8); margin: 0; font-size: 12px;">
                © ${new Date().getFullYear()} International Blockchain Community Complaints Forum. All rights reserved.
              </p>
            </div>
          </div>
        `,
      });
      
      console.log(`Confirmation email sent to ${toEmail} for request ${requestId}`);
      return true;
    } catch (error) {
      console.error('Error sending confirmation email:', error);
      return false;
    }
  }

  async sendKeyApprovalNotification(
    toEmail: string,
    userName: string,
    accessKey: string
  ): Promise<boolean> {
    try {
      const transporter = this.getTransporter();
      
      await transporter.sendMail({
        from: `"IBCCF Support" <${ZOHO_EMAIL}>`,
        to: toEmail,
        subject: 'Your Access Key is Ready - IBCCF',
        html: `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #004182 0%, #004AB3 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">IBCCF</h1>
              <p style="color: rgba(255,255,255,0.8); margin: 10px 0 0 0;">International Blockchain Community Complaints Forum</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
              <h2 style="color: #004182; margin-top: 0;">Hello ${userName},</h2>
              
              <p style="color: #333; line-height: 1.6;">
                Great news! Your access key request has been <strong style="color: #28a745;">approved</strong>. You can now access the secure portal using the access key below.
              </p>
              
              <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); border-radius: 8px; padding: 25px; margin: 20px 0; text-align: center;">
                <p style="color: rgba(255,255,255,0.9); margin: 0 0 10px 0; font-size: 14px;">Your Access Key:</p>
                <p style="color: white; font-size: 36px; font-weight: bold; margin: 0; font-family: monospace; letter-spacing: 4px;">${accessKey}</p>
              </div>
              
              <p style="color: #333; line-height: 1.6;">
                <strong>How to access your portal:</strong>
              </p>
              <ol style="color: #333; line-height: 1.8;">
                <li>Visit our verification portal</li>
                <li>Enter your access key shown above</li>
                <li>Complete your profile setup</li>
                <li>Set up your secure 6-digit PIN</li>
              </ol>
              
              <p style="color: #dc3545; line-height: 1.6; font-size: 13px;">
                <strong>Security Notice:</strong> Keep this access key confidential. Do not share it with anyone. Our team will never ask for your access key or PIN.
              </p>
              
              <hr style="border: none; border-top: 1px solid #e9ecef; margin: 25px 0;">
              
              <p style="color: #666; font-size: 13px; margin-bottom: 0;">
                If you have any questions, please contact our support team.
              </p>
            </div>
            
            <div style="background: #004182; padding: 20px; border-radius: 0 0 10px 10px; text-align: center;">
              <p style="color: rgba(255,255,255,0.8); margin: 0; font-size: 12px;">
                © ${new Date().getFullYear()} International Blockchain Community Complaints Forum. All rights reserved.
              </p>
            </div>
          </div>
        `,
      });
      
      console.log(`Approval email sent to ${toEmail} with access key`);
      return true;
    } catch (error) {
      console.error('Error sending approval email:', error);
      return false;
    }
  }

  async sendAdminMessageNotification(
    toEmail: string,
    userName: string,
    requestId: string,
    message: string
  ): Promise<boolean> {
    try {
      const transporter = this.getTransporter();
      
      await transporter.sendMail({
        from: `"IBCCF Support" <${ZOHO_EMAIL}>`,
        to: toEmail,
        subject: 'New Message Regarding Your Request - IBCCF',
        html: `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #004182 0%, #004AB3 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">IBCCF</h1>
              <p style="color: rgba(255,255,255,0.8); margin: 10px 0 0 0;">International Blockchain Community Complaints Forum</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 30px; border: 1px solid #e9ecef; border-top: none;">
              <h2 style="color: #004182; margin-top: 0;">Hello ${userName},</h2>
              
              <p style="color: #333; line-height: 1.6;">
                You have received a new message regarding your access key request <strong>${requestId}</strong>:
              </p>
              
              <div style="background: white; border-left: 4px solid #004182; padding: 15px 20px; margin: 20px 0;">
                <p style="color: #333; margin: 0; line-height: 1.6; white-space: pre-wrap;">${message}</p>
              </div>
              
              <p style="color: #333; line-height: 1.6;">
                Please visit our portal to check your request status and respond if needed.
              </p>
              
              <hr style="border: none; border-top: 1px solid #e9ecef; margin: 25px 0;">
              
              <p style="color: #666; font-size: 13px; margin-bottom: 0;">
                This is an automated message. Please do not reply directly to this email.
              </p>
            </div>
            
            <div style="background: #004182; padding: 20px; border-radius: 0 0 10px 10px; text-align: center;">
              <p style="color: rgba(255,255,255,0.8); margin: 0; font-size: 12px;">
                © ${new Date().getFullYear()} International Blockchain Community Complaints Forum. All rights reserved.
              </p>
            </div>
          </div>
        `,
      });
      
      console.log(`Admin message notification sent to ${toEmail} for request ${requestId}`);
      return true;
    } catch (error) {
      console.error('Error sending admin message notification:', error);
      return false;
    }
  }
}

export const emailService = new EmailService();
