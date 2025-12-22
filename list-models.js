require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function checkModels() {
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  
  console.log("Checking available models...");
  try {
    // This calls the API to list everything your key has access to
    const modelResponse = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Dummy init to get access to client
    // Note: The SDK doesn't expose a direct 'listModels' helper easily on the instance in all versions, 
    // so we use a fetch to the raw endpoint to be 100% sure what the API sees.
    
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();

    if (data.models) {
        console.log("\n✅ AVAILABLE MODELS:");
        data.models.forEach(m => {
            // Filter for 'generateContent' support
            if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")) {
                console.log(` - ${m.name.replace('models/', '')}`);
            }
        });
    } else {
        console.log("❌ No models found. Raw response:", data);
    }
    
  } catch (err) {
    console.error("❌ Error listing models:", err.message);
  }
}

checkModels();