'use strict';

const fs = require('fs');
const path = require('path');

// Load translation files synchronously at startup
const locales = {};
const localesDir = path.join(__dirname, '..', 'locales');

try {
  locales.id = JSON.parse(fs.readFileSync(path.join(localesDir, 'id.json'), 'utf8'));
} catch (err) {
  console.error('❌ Failed to load Indonesian locales:', err.message);
  locales.id = {};
}

try {
  locales.en = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf8'));
} catch (err) {
  console.error('❌ Failed to load English locales:', err.message);
  locales.en = {};
}

// Generate the dynamic translation mapping (Indonesian value -> English value)
let translationPairs = null;
function getTranslationPairs() {
  if (translationPairs) return translationPairs;

  const pairs = [];
  const idDict = locales.id || {};
  const enDict = locales.en || {};

  for (const key in idDict) {
    const idVal = idDict[key];
    const enVal = enDict[key];
    if (idVal && enVal && idVal !== enVal) {
      pairs.push({ from: idVal, to: enVal });
    }
  }

  // Sort descending by length of 'from' to ensure longer patterns are matched first
  pairs.sort((a, b) => b.from.length - a.from.length);
  translationPairs = pairs;
  return translationPairs;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function translateText(text) {
  const pairs = getTranslationPairs();
  let result = text;
  for (const pair of pairs) {
    const fromText = pair.from;
    const toText = pair.to;

    // Use boundary matching only if the start/end boundary character is alphanumeric (word char).
    // This allows phrases like "Persetujuan Harga (FAT)" to match correctly even with the closing bracket.
    const firstCharIsWord = /^\w/.test(fromText);
    const lastCharIsWord = /\w$/.test(fromText);

    let regexStr = escapeRegExp(fromText);
    if (firstCharIsWord) regexStr = '\\b' + regexStr;
    if (lastCharIsWord) regexStr = regexStr + '\\b';

    const regex = new RegExp(regexStr, 'g');
    result = result.replace(regex, toText);
  }
  return result;
}

function translateTag(tag) {
  // Translate placeholder attribute
  tag = tag.replace(/placeholder="([^"]+)"/g, (match, p1) => {
    return `placeholder="${translateText(p1)}"`;
  });
  tag = tag.replace(/placeholder='([^']+)'/g, (match, p1) => {
    return `placeholder='${translateText(p1)}'`;
  });
  
  // Translate title attribute
  tag = tag.replace(/title="([^"]+)"/g, (match, p1) => {
    return `title="${translateText(p1)}"`;
  });
  tag = tag.replace(/title='([^']+)'/g, (match, p1) => {
    return `title='${translateText(p1)}'`;
  });

  // Translate input button values
  tag = tag.replace(/value="([^"]+)"/g, (match, p1) => {
    if (tag.includes('type="button"') || tag.includes('type="submit"') || tag.includes('type="reset"') ||
        tag.includes("type='button'") || tag.includes("type='submit'") || tag.includes("type='reset'")) {
      return `value="${translateText(p1)}"`;
    }
    return match;
  });
  tag = tag.replace(/value='([^']+)'/g, (match, p1) => {
    if (tag.includes('type="button"') || tag.includes('type="submit"') || tag.includes('type="reset"') ||
        tag.includes("type='button'") || tag.includes("type='submit'") || tag.includes("type='reset'")) {
      return `value='${translateText(p1)}'`;
    }
    return match;
  });
  
  return tag;
}

function translateHtml(html) {
  // Split HTML into tag tokens and non-tag tokens
  const parts = html.split(/(<[^>]+>)/g);
  let inScript = false;

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      // Odd indices are tags
      const tag = parts[i].toLowerCase();
      if (tag.startsWith('<script')) {
        inScript = true;
      } else if (tag.startsWith('</script')) {
        inScript = false;
      } else {
        // Safe translation inside tag attributes (placeholder, title, button values)
        parts[i] = translateTag(parts[i]);
      }
    } else {
      // Even indices are text nodes
      if (!inScript && parts[i].trim() !== '') {
        parts[i] = translateText(parts[i]);
      }
    }
  }

  return parts.join('');
}

/**
 * i18n Middleware
 * Determines active language, stores it in session, exposes translation helper,
 * and intercepts res.render to auto-translate dynamic EJS outputs.
 */
function i18nMiddleware(req, res, next) {
  // 1. Allow changing language via query parameter: ?lang=en or ?lang=id
  if (req.query.lang && ['id', 'en'].includes(req.query.lang)) {
    req.session.lang = req.query.lang;
  }

  // 2. Determine final active language (Session > Default: 'id')
  const lang = req.session.lang || 'id';
  req.session.lang = lang;

  // 3. Expose current language and translation helper to views
  res.locals.currentLang = lang;
  
  res.locals.__ = (key) => {
    const dictionary = locales[lang] || locales.id;
    return dictionary[key] !== undefined ? dictionary[key] : key;
  };

  // 4. Overwrite res.render to perform HTML post-translation if English is active
  const originalRender = res.render;
  res.render = function (view, options, fn) {
    const self = this;
    
    if (typeof options === 'function') {
      fn = options;
      options = {};
    }

    if (lang === 'id') {
      return originalRender.call(self, view, options, fn);
    }

    if (typeof fn === 'function') {
      originalRender.call(self, view, options, function (err, html) {
        if (err) return fn(err);
        html = translateHtml(html);
        fn(null, html);
      });
    } else {
      originalRender.call(self, view, options, function (err, html) {
        if (err) return req.next(err);
        html = translateHtml(html);
        self.send(html);
      });
    }
  };

  next();
}

module.exports = i18nMiddleware;
