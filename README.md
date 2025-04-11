# Puppeteer Element Scraper API

A simple Express API for scraping HTML elements from web pages using Puppeteer, with support for browser extensions.

## Features

- Scrape HTML of a specific element using CSS or XPath selectors
- Load Chromium extensions for advanced scraping
- Health check endpoint
- Cleans up browser data after each request
- Robust error handling

## Requirements

- Node.js 16+
- Chromium/Chrome installed (or provide path via `EXECUTABLE_PATH`)
- (Optional) Chrome extensions

## Installation

```bash
git clone https://github.com/yourusername/puppeteer-element-scraper.git
cd puppeteer-element-scraper
npm install

