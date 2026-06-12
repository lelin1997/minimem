/**
 * output-email 执行器
 * 发送邮件通知 — 支持真正的 SMTP 发送
 * 需要在 config.toml 的 [smtp] 段配置连接信息
 */

import type { NodeExecutor } from './index.js';
import { renderTemplate } from '../engine/template.js';
import { getConfig } from '../config.js';

export const outputEmailExecutor: NodeExecutor = async (node, inputs, _ctx, templateData) => {
  const cfg = node.config as Record<string, any>;

  const to = String(cfg.to || '');
  if (!to) {
    throw new Error('output-email 节点缺少必填参数 to（收件人）');
  }

  const content = inputs.in;
  const extendedData = {
    ...templateData,
    input: content,
    text: typeof content === 'string' ? content : undefined,
  };

  const subject = cfg.subject_template
    ? renderTemplate(String(cfg.subject_template), extendedData)
    : 'MiniMem Console 通知';

  const bodyFormat = cfg.body_format || 'text';
  const body = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

  // 检查 SMTP 配置
  const config = getConfig();
  const smtp = config.smtp;

  if (!smtp.enabled || !smtp.host) {
    // SMTP 未配置 — 返回详细信息但标记未发送
    console.log(`[output-email] SMTP 未启用，邮件未发送。收件人: ${to}，主题: ${subject}`);
    return {
      outputs: {
        out: {
          to,
          subject,
          body_format: bodyFormat,
          body_preview: body.slice(0, 200),
          sent: false,
          reason: 'SMTP 未启用。请在 config.toml 中配置 [smtp] 段并设置 enabled = true。',
        },
      },
    };
  }

  // 使用 nodemailer 发送邮件
  try {
    const nodemailer = await import('nodemailer');

    const transporter = nodemailer.default.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: (smtp.user && smtp.pass) ? {
        user: smtp.user,
        pass: smtp.pass,
      } : undefined,
    });

    // 构建邮件内容
    const mailOptions: Record<string, any> = {
      from: smtp.from_address
        ? `"${smtp.from_name}" <${smtp.from_address}>`
        : smtp.user,
      to,
      subject,
    };

    if (bodyFormat === 'html') {
      mailOptions.html = body;
    } else if (bodyFormat === 'markdown') {
      // Markdown 作为纯文本发送，同时附带 HTML 预览
      mailOptions.text = body;
      mailOptions.html = `<pre style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; white-space: pre-wrap; line-height: 1.6;">${escapeHtml(body)}</pre>`;
    } else {
      mailOptions.text = body;
    }

    const info = await transporter.sendMail(mailOptions);

    console.log(`[output-email] 邮件已发送至 ${to}，Message-ID: ${info.messageId}`);

    return {
      outputs: {
        out: {
          to,
          subject,
          body_format: bodyFormat,
          body_length: body.length,
          sent: true,
          message_id: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
        },
      },
    };
  } catch (err: any) {
    throw new Error(`邮件发送失败: ${err.message}`);
  }
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
