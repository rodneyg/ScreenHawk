// api.ts

import axios from 'axios';

const OPENAI_API_KEY = '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'; // Replace with your actual OpenAI API key
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

interface OpenAIResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

export async function sendToOpenAI(prompt: string, screenshot: string): Promise<string> {
  try {
    // Remove the data URL prefix from the screenshot
    const base64Image = screenshot.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

    const response = await axios.post<OpenAIResponse>(
      OPENAI_API_URL,
      {
        model: 'gpt-4o', // Using the new 4o model
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 500
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        }
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    throw new Error('Failed to get response from OpenAI');
  }
}