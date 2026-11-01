import React, { useMemo } from 'react';
import { marked } from 'marked';
import katex from 'katex';
import './markdown.css';

const renderer = new marked.Renderer();

renderer.image = ({ href, text }) => {
  const safeText = text || '声场计算结果';
  return `<div class="chat-md-image" data-img-url="${href}" data-img-caption="${safeText}">
    <img src="${href}" alt="${safeText}" loading="lazy"/>
    <div class="chat-md-image-bar">
      <span>🖼️ ${safeText}</span>
      <span class="chat-md-zoom-hint">点击放大查看 🔍</span>
    </div>
  </div>`;
};

renderer.link = ({ href, text }) => {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};

function renderMarkdownWithMath(content) {
  if (!content) return '';
  const mathTokens = [];

  // 1. Extract and render display math $$...$$
  let processed = content.replace(/\$\$([\s\S]+?)\$\$/g, (match, expr) => {
    try {
      const rendered = katex.renderToString(expr.trim(), {
        displayMode: true,
        throwOnError: false
      });
      const idx = mathTokens.length;
      mathTokens.push(rendered);
      return `%%MATH_DISP_${idx}%%`;
    } catch {
      return match;
    }
  });

  // 2. Extract and render inline math $...$
  processed = processed.replace(/(?<!\\)\$([^\$\n]+?)\$/g, (match, expr) => {
    try {
      const rendered = katex.renderToString(expr.trim(), {
        displayMode: false,
        throwOnError: false
      });
      const idx = mathTokens.length;
      mathTokens.push(rendered);
      return `%%MATH_INL_${idx}%%`;
    } catch {
      return match;
    }
  });

  // 3. Parse with marked
  let html = marked.parse(processed, {
    renderer,
    gfm: true,
    breaks: true
  });

  // 4. Restore rendered math tokens
  html = html.replace(/%%MATH_(?:DISP|INL)_(\d+)%%/g, (match, idx) => {
    return mathTokens[parseInt(idx, 10)] || match;
  });

  return html;
}

export default function MarkdownRenderer({ content, setImage }) {
  const html = useMemo(() => renderMarkdownWithMath(content), [content]);

  const handleClick = (e) => {
    const imgContainer = e.target.closest('.chat-md-image');
    if (imgContainer && setImage) {
      const url = imgContainer.getAttribute('data-img-url');
      const caption = imgContainer.getAttribute('data-img-caption');
      if (url) {
        setImage({ url, caption: caption || '声场计算结果' });
      }
    }
  };

  return (
    <div
      className="markdown-body"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
