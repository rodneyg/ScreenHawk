// api.ts

import axios from 'axios';

const OPENAI_API_KEY = ''; // Replace with your actual OpenAI API key
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

interface OpenAIResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

export async function sendToOpenAI(prompt: string, screenshot: string): Promise<string> {
  console.log("sendToOpenAI called with prompt:", prompt);
  console.log("Screenshot data:", screenshot ? "Available" : "Not available");

  try {
    const response = await axios.post<OpenAIResponse>(
      OPENAI_API_URL,
      {
        model: 'gpt-4o',
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
                image_url: screenshot
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

    console.log("Received response from OpenAI:", response.data);
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    if (axios.isAxiosError(error) && error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    throw new Error('Failed to get response from OpenAI');
  }
}