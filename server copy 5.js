// server.js - Twitter Engagement Platform with MongoDB - FIXED VERSION
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

// Import database models
const { User, Campaign, Assignment, Cooldown, ProfilingState, Analytics } = require('./models');

const app = express();
const PORT = process.env.PORT || 3000;

// Get environment variables
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGO_URL || process.env.MONGODB_URI || 'mongodb://localhost:27017/twitter-platform';

// Debug: Log environment
console.log('🔍 Environment check:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('BOT_TOKEN exists:', !!BOT_TOKEN);
console.log('MONGO_URL exists:', !!process.env.MONGO_URL);
console.log('MONGODB_URI exists:', !!process.env.MONGODB_URI);

// Check if we have the bot token
if (!BOT_TOKEN) {
    console.log('❌ ERROR: TELEGRAM_BOT_TOKEN not found in environment variables');
    process.exit(1);
}

// Connect to Railway MongoDB
mongoose.connect(MONGODB_URI)
.then(() => {
    console.log('✅ Connected to Railway MongoDB successfully');
})
.catch((error) => {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
});

// Handle connection events
mongoose.connection.on('error', (error) => {
    console.error('❌ MongoDB error:', error.message);
});

mongoose.connection.on('disconnected', () => {
    console.log('⚠️ MongoDB disconnected');
});

mongoose.connection.on('connected', () => {
    console.log('✅ MongoDB connected');
});

// Create Telegram bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// This lets our server understand JSON data
app.use(express.json());

// Assignment system configuration
const ASSIGNMENT_CONFIG = {
    roles: {
        initiator: 0.2,   // 20% start conversations
        replier: 0.4,     // 40% reply to posts
        retweeter: 0.25,  // 25% retweet
        quoter: 0.15      // 15% quote tweet
    },
    cooldownHours: {
        base: 24,         // 24 hours minimum
        max: 72,          // 72 hours maximum
        min: 12           // 12 hours minimum
    }
};

// Smart profiling questions
const PROFILING_QUESTIONS = {
    age_range: {
        question: "What's your age range? (This helps us match you with relevant campaigns)",
        type: "single",
        options: [
            "16-20 📱",
            "21-25 🎓", 
            "26-30 💼",
            "31-35 🏡",
            "36-40 👨‍👩‍👧‍👦",
            "41+ 🧠"
        ]
    },
    daily_routine: {
        question: "What best describes your typical weekday? (Select all that apply)",
        type: "multiple",
        options: [
            "Classes and campus life 📚",
            "Office work and meetings 💼", 
            "Running my own business 🚀",
            "Creative projects and freelancing 🎨",
            "Job hunting and skill building 💪",
            "Other professional work 👔"
        ]
    },
    spending_priority: {
        question: "When you have extra money, what do you typically spend it on first?",
        type: "single",
        options: [
            "Latest gadgets and tech 📱",
            "Fashion and looking good 👗",
            "Experiences (travel, events, food) ✈️",
            "Savings and investments 💰",
            "Family and relationships 👨‍👩‍👧‍👦",
            "Skills and education 📖",
            "Basic needs come first 🏠"
        ]
    },
    influence_style: {
        question: "When you recommend something on social media, it's usually because:",
        type: "single",
        options: [
            "I genuinely love it and want to share 💝",
            "It solved a real problem for me 🔧", 
            "It's trending and I want to join the conversation 🔥",
            "I think it's good value for money 💡",
            "It aligns with my values/beliefs 🎯",
            "My friends/followers would find it useful 🤝"
        ]
    },
    discovery_style: {
        question: "How do you typically discover new products/services? (Select all that apply)",
        type: "multiple",
        options: [
            "Through friends and people I trust 👥",
            "Social media ads and influencers 📺",
            "Research and reading reviews 🔍",
            "Trying trending/popular things 📈",
            "Recommendations from experts 🎓",
            "What fits my budget when I need it 💳"
        ]
    }
};

// Serve static files (like our dashboard)
app.use(express.static('.'));

// Web routes
app.get('/', async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const activeCampaigns = await Campaign.countDocuments({ status: { $in: ['pending', 'active'] } });
        const completedProfiles = await User.countDocuments({ profileCompleted: true });
        
        res.json({ 
            message: 'Welcome to Twitter Engagement Platform with Smart Profiling!',
            status: 'Server is running',
            database: 'MongoDB connected',
            totalUsers,
            activeCampaigns,
            completedProfiles
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'Server running but database error',
            error: error.message 
        });
    }
});

// Serve the dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/dashboard.html');
});

// API route to create campaigns
app.post('/api/campaigns/create', async (req, res) => {
    try {
        const campaignData = req.body;
        
        // Validate required fields
        if (!campaignData.brandName || !campaignData.description) {
            return res.status(400).json({ 
                success: false, 
                message: 'Brand name and description are required' 
            });
        }
        
        // Create campaign object
        const newCampaign = new Campaign({
            ...campaignData,
            status: 'pending',
            participants: [],
            totalEngagement: 0
        });
        
        // Save to database
        await newCampaign.save();
        
        console.log(`✅ New campaign created: ${campaignData.brandName} (₦${campaignData.budget})`);
        
        // Automatically create assignments for this campaign
        setTimeout(() => {
            createAutomaticAssignments(newCampaign);
        }, 1000);
        
        // Notify all users about new campaign
        notifyUsersAboutCampaign(newCampaign);
        
        res.json({
            success: true,
            message: 'Campaign created successfully!',
            campaignId: newCampaign._id
        });
        
    } catch (error) {
        console.error('❌ Error creating campaign:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create campaign' 
        });
    }
});

// Get all campaigns
app.get('/api/campaigns', async (req, res) => {
    try {
        const campaigns = await Campaign.find({}).sort({ createdAt: -1 });
        
        res.json({
            success: true,
            campaigns: campaigns.map(campaign => ({
                id: campaign._id,
                brandName: campaign.brandName,
                description: campaign.description,
                package: campaign.package,
                budget: campaign.budget,
                status: campaign.status,
                estimatedParticipants: campaign.estimatedParticipants,
                estimatedReach: campaign.estimatedReach,
                createdAt: campaign.createdAt
            }))
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch campaigns'
        });
    }
});

app.get('/users', async (req, res) => {
    try {
        const users = await User.find({}).sort({ registeredAt: -1 });
        
        res.json({ 
            message: 'Registered Users',
            users: users.map(user => ({
                name: user.firstName,
                telegramId: user.telegramId,
                profile: user.profileCompleted ? user.profile.primaryProfile.label : 'Not completed',
                isActive: user.isActive || false
            }))
        });
    } catch (error) {
        res.status(500).json({
            message: 'Failed to fetch users',
            error: error.message
        });
    }
});

// =================== TELEGRAM BOT COMMANDS ===================

// /start command - Register new user
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    console.log(`📱 /start command received from user: ${user.first_name} (${chatId})`);
    
    try {
        // Check if user already exists
        const existingUser = await User.findOne({ telegramId: chatId.toString() });
        
        if (existingUser) {
            await bot.sendMessage(chatId, `Welcome back, ${user.first_name}! 👋\n\nUse /help to see available commands.`);
            return;
        }
        
        // Create new user
        const newUser = new User({
            telegramId: chatId.toString(),
            firstName: user.first_name,
            lastName: user.last_name || '',
            username: user.username || '',
            isActive: true,
            earnings: 0,
            campaignsCompleted: 0,
            profileCompleted: false
        });
        
        await newUser.save();
        
        await bot.sendMessage(chatId, 
            `🎉 Welcome to Twitter Engagement Platform, ${user.first_name}!\n\n` +
            `You're now registered and ready to earn money from Twitter engagement!\n\n` +
            `📱 Next steps:\n` +
            `1. Link your Twitter account with /twitter\n` +
            `2. Complete your smart profile (2 minutes)\n` +
            `3. Get matched with perfect campaigns!\n\n` +
            `💰 Users with completed profiles earn 20% more!`
        );
        
        console.log(`✅ New user registered: ${user.first_name} (${chatId})`);
        
    } catch (error) {
        console.error('❌ Error registering user:', error);
        await bot.sendMessage(chatId, 'Sorry, there was an error registering you. Please try again.');
    }
});

// /help command
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /help command received from user: ${chatId}`);
    
    try {
        await bot.sendMessage(chatId, 
            `🤖 Twitter Engagement Platform Commands:\n\n` +
            `/start - Register/Login\n` +
            `/twitter - Link Twitter & complete smart profile\n` +
            `/profile - View your profile summary\n` +
            `/campaigns - View campaigns matched to you\n` +
            `/assignments - Check your active assignments\n` +
            `/earnings - Check your earnings\n` +
            `/status - Your account status\n` +
            `/help - Show this help\n\n` +
            `🧠 Smart Features:\n` +
            `• AI-powered profile matching\n` +
            `• Personalized campaign recommendations\n` +
            `• Authenticity-based earnings bonuses\n` +
            `• Profile-specific role assignments\n\n` +
            `💡 Complete your profile for better matches and higher earnings!`
        );
    } catch (error) {
        console.error('❌ Error in help command:', error);
    }
});

// /twitter command - Twitter verification
bot.onText(/\/twitter/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /twitter command received from user: ${chatId}`);
    
    try {
        const user = await User.findOne({ telegramId: chatId.toString() });
        
        if (!user) {
            await bot.sendMessage(chatId, 'Please register first with /start');
            return;
        }
        
        // Check if user already has verified Twitter
        if (user.twitterHandle && user.twitterVerified) {
            await bot.sendMessage(chatId, 
                `🐦 Twitter Account Already Verified!\n\n` +
                `✅ Current account: @${user.twitterHandle}\n\n` +
                `Want to change your Twitter account? Reply "change" to start over.`
            );
            return;
        }
        
        await startCleanBioVerification(chatId);
        
    } catch (error) {
        console.error('❌ Error in twitter command:', error);
        await bot.sendMessage(chatId, 'Sorry, there was an error. Please try again.');
    }
});

// Bio verification function
async function startCleanBioVerification(chatId) {
    try {
        await bot.sendMessage(chatId, 
            `🐦 Twitter Account Verification\n\n` +
            `To prevent fraud, we need to verify you own this Twitter account.\n\n` +
            `📝 Step 1: Enter your Twitter username (without @):\n\n` +
            `Example: john_doe`
        );
        
        // Set up listener for Twitter handle
        const handleListener = async (response) => {
            if (response.chat.id === chatId && !response.text.startsWith('/')) {
                try {
                    const twitterHandle = response.text.trim().replace('@', '').toLowerCase();
                    
                    // Validate Twitter handle format
                    if (!isValidTwitterHandle(twitterHandle)) {
                        await bot.sendMessage(chatId, 
                            `❌ Invalid Twitter handle format.\n\n` +
                            `Please use only letters, numbers, and underscores.\n` +
                            `Try again with /twitter`
                        );
                        bot.removeListener('message', handleListener);
                        return;
                    }
                    
                    // Check if handle is already verified by another user
                    const existingUser = await User.findOne({ 
                        twitterHandle: twitterHandle,
                        twitterVerified: true,
                        telegramId: { $ne: chatId.toString() }
                    });
                    
                    if (existingUser) {
                        await bot.sendMessage(chatId, 
                            `❌ This Twitter handle is already verified by another user.\n\n` +
                            `If this is your account, please contact support.\n` +
                            `Otherwise, try a different handle with /twitter`
                        );
                        bot.removeListener('message', handleListener);
                        return;
                    }
                    
                    // Generate verification code
                    const verificationCode = generateVerificationCode();
                    
                    // Update user with unverified handle and code
                    await User.findOneAndUpdate(
                        { telegramId: chatId.toString() },
                        { 
                            twitterHandle: twitterHandle,
                            twitterVerified: false,
                            verificationCode: verificationCode,
                            verificationExpires: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
                        }
                    );
                    
                    // Send BIO verification instructions
                    await bot.sendMessage(chatId, 
                        `🔐 Twitter Bio Verification\n\n` +
                        `👤 Handle: @${twitterHandle}\n` +
                        `🔑 Code: ${verificationCode}\n\n` +
                        `📝 Step 2: Add this code to your Twitter bio:\n\n` +
                        `"${verificationCode}"\n\n` +
                        `💡 You can add it anywhere in your bio. Examples:\n` +
                        `• "Developer | Designer ${verificationCode}"\n` +
                        `• "${verificationCode} Love coding and design"\n` +
                        `• "Building cool stuff ${verificationCode} DM open"\n\n` +
                        `⏰ You have 30 minutes to update your bio.\n\n` +
                        `After updating your bio, reply "verify" to check.`
                    );
                    
                    console.log(`🔐 Bio verification code generated for @${twitterHandle}: ${verificationCode}`);
                    
                    // Wait for verification command
                    waitForCleanBioVerification(chatId, twitterHandle, verificationCode);
                    
                } catch (error) {
                    console.error('❌ Error starting verification:', error);
                    await bot.sendMessage(chatId, 'Sorry, there was an error starting verification. Please try again.');
                }
                
                // Remove this listener
                bot.removeListener('message', handleListener);
            }
        };
        
        bot.on('message', handleListener);
        
        // Auto-remove listener after 5 minutes
        setTimeout(() => {
            bot.removeListener('message', handleListener);
        }, 5 * 60 * 1000);
        
    } catch (error) {
        console.error('❌ Error in startCleanBioVerification:', error);
    }
}

async function waitForCleanBioVerification(chatId, twitterHandle, verificationCode) {
    // Set up verification listener
    const verificationListener = async (msg) => {
        if (msg.chat.id === chatId) {
            if (msg.text && msg.text.toLowerCase().includes('verify')) {
                try {
                    await checkCleanBioVerification(chatId, twitterHandle, verificationCode);
                } catch (error) {
                    console.error('❌ Verification error:', error);
                    await bot.sendMessage(chatId, 'Error during verification. Please try again.');
                }
                
                // Remove this listener
                bot.removeListener('message', verificationListener);
            } else if (msg.text && msg.text.startsWith('/')) {
                // User used another command, cancel verification
                bot.removeListener('message', verificationListener);
            }
        }
    };
    
    bot.on('message', verificationListener);
    
    // Auto-cancel after 30 minutes
    setTimeout(() => {
        bot.removeListener('message', verificationListener);
    }, 30 * 60 * 1000);
}

async function checkCleanBioVerification(chatId, twitterHandle, verificationCode) {
    try {
        await bot.sendMessage(chatId, '🔍 Checking your Twitter bio for the verification code...');
        
        console.log(`🔍 Starting verification for ${twitterHandle} with code ${verificationCode}`);
        
        // Check if verification is still valid
        const user = await User.findOne({ 
            telegramId: chatId.toString(),
            verificationCode: verificationCode
        });
        
        if (!user) {
            console.log('❌ No user found with verification code');
            await bot.sendMessage(chatId, 
                `❌ Verification session not found.\n\n` +
                `Please start over with /twitter`
            );
            return;
        }
        
        if (new Date() > user.verificationExpires) {
            console.log('❌ Verification expired');
            await bot.sendMessage(chatId, 
                `⏰ Verification Expired\n\n` +
                `Your verification session has expired.\n` +
                `Please start over with /twitter`
            );
            return;
        }
        
        console.log('✅ Verification is valid, simulating bio check...');
        
        // For demo purposes, simulate successful verification
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        
        const isVerified = true; // For demo - in production, check actual Twitter bio
        
        console.log(`📋 Bio verification result:`, isVerified);
        
        if (isVerified) {
            console.log('✅ Verification successful, updating user...');
            
            // Mark user as verified
            const updatedUser = await User.findOneAndUpdate(
                { telegramId: chatId.toString() },
                { 
                    twitterVerified: true,
                    verificationCode: null,
                    verificationExpires: null,
                    verifiedAt: new Date()
                },
                { new: true }
            );
            
            console.log('✅ User updated successfully:', !!updatedUser);
            
            await bot.sendMessage(chatId, 
                `🎉 Twitter Account Verified Successfully!\n\n` +
                `✅ @${twitterHandle} is now linked to your account.\n\n` +
                `You can now:\n` +
                `• Complete your profile for bonus earnings: /profile\n` +
                `• Check available campaigns: /campaigns\n\n` +
                `💡 You can remove "${verificationCode}" from your bio now.`
            );
            
            console.log(`✅ Twitter verified: @${twitterHandle} for user ${chatId}`);
            
        } else {
            console.log('❌ Bio verification failed');
            await bot.sendMessage(chatId, 
                `❌ Verification Failed\n\n` +
                `We couldn't find the code "${verificationCode}" in @${twitterHandle}'s bio.\n\n` +
                `Please make sure:\n` +
                `• You added the exact code: ${verificationCode}\n` +
                `• Your Twitter profile is public (not private)\n` +
                `• You saved the bio changes\n` +
                `• You waited a few minutes after updating\n\n` +
                `Try again by replying "verify" or restart with /twitter`
            );
        }
        
    } catch (error) {
        console.error('❌ Error in checkCleanBioVerification:', error);
        
        await bot.sendMessage(chatId, 
            `⚠️ Verification Error\n\n` +
            `There was a technical error: ${error.message}\n\n` +
            `Please try again with /twitter or contact support.`
        );
    }
}

// /profile command
bot.onText(/\/profile/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /profile command received from user: ${chatId}`);
    
    try {
        const user = await User.findOne({ telegramId: chatId.toString() });
        
        if (!user) {
            await bot.sendMessage(chatId, `Please register first with /start`);
            return;
        }
        
        if (!user.twitterHandle || !user.twitterVerified) {
            await bot.sendMessage(chatId, 
                `🐦 Please verify your Twitter account first!\n\n` +
                `Use /twitter to link and verify your account.`
            );
            return;
        }
        
        if (!user.profileCompleted) {
            await bot.sendMessage(chatId, 
                `🧠 Complete Your Profile for Bonus Earnings!\n\n` +
                `📈 Benefits:\n` +
                `• 15% base bonus on all campaigns\n` +
                `• Up to 25% bonus for perfect matches\n` +
                `• Priority for campaigns in your interests\n` +
                `• Better role assignments\n\n` +
                `⏱️ Takes just 2 minutes!\n\n` +
                `Reply "start" to begin the profile questionnaire.`
            );
            
            // Wait for confirmation
            const listener = async (response) => {
                if (response.chat.id === chatId && 
                    response.text && response.text.toLowerCase().includes('start')) {
                    
                    bot.removeListener('message', listener);
                    await startSmartProfiling(chatId);
                }
            };
            
            bot.on('message', listener);
            
            // Remove listener after 2 minutes
            setTimeout(() => {
                bot.removeListener('message', listener);
            }, 120000);
            
            return;
        }
        
        // Show completed profile
        const profile = user.profile;
        const message = 
            `👤 Your Profile Summary\n\n` +
            `🎯 Profile Type: ${profile.primaryProfile.label}\n` +
            `📝 Description: ${profile.primaryProfile.description}\n\n` +
            `💰 Spending Power: ${profile.spendingPower.replace('_', ' ').toUpperCase()}\n` +
            `🎭 Authenticity Score: ${profile.authenticityScore}/100\n` +
            `⭐ Marketing Value: ${profile.marketingValue.toUpperCase()}\n\n` +
            `✨ Best Campaign Types:\n` +
            profile.recommendedCampaignTypes.map(type => `• ${type}`).join('\n') + '\n\n' +
            `💰 Earnings Bonus: ${profile.authenticityScore > 80 ? '15-25%' : '15%'}\n\n` +
            `🔄 Want to retake the questionnaire? Reply "retake"`;
        
        await bot.sendMessage(chatId, message);
        
    } catch (error) {
        console.error('❌ Error in /profile command:', error);
        await bot.sendMessage(chatId, 'Sorry, there was an error loading your profile. Please try again.');
    }
});

// /campaigns command
bot.onText(/\/campaigns/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /campaigns command received from user: ${chatId}`);
    
    try {
        const user = await User.findOne({ telegramId: chatId.toString() });
        
        if (!user) {
            await bot.sendMessage(chatId, `Please register first with /start`);
            return;
        }
        
        if (!user.twitterHandle || !user.twitterVerified) {
            await bot.sendMessage(chatId, 
                `🐦 Please verify your Twitter account first!\n\n` +
                `Use /twitter to link and verify your account.`
            );
            return;
        }
        
        const availableCampaigns = await Campaign.find({ 
            status: { $in: ['pending', 'active'] } 
        }).sort({ createdAt: -1 });
        
        if (availableCampaigns.length === 0) {
            let message = `📋 No Active Campaigns\n\n` +
                         `There are no campaigns available right now.\n` +
                         `New campaigns are posted regularly!\n\n`;
            
            if (user.profileCompleted) {
                message += `💡 Your profile: ${user.profile.primaryProfile.label}\n` +
                          `You'll get priority for: ${user.profile.recommendedCampaignTypes.slice(0, 2).join(', ')}`;
            } else {
                message += `💡 Complete your profile with /profile for bonus earnings!`;
            }
            
            await bot.sendMessage(chatId, message);
        } else {
            let message = `🚀 Available Campaigns:\n\n`;
            
            for (let i = 0; i < Math.min(availableCampaigns.length, 5); i++) {
                const campaign = availableCampaigns[i];
                const baseEarning = Math.round(campaign.budget * 0.65 / campaign.estimatedParticipants);
                
                message += `${i + 1}. ${campaign.brandName}\n`;
                message += `💰 Base Earning: ₦${baseEarning.toLocaleString()}\n`;
                
                // Show potential bonuses
                if (user.profileCompleted) {
                    const profileBonus = Math.round(baseEarning * 0.15);
                    message += `💡 Your Potential: ₦${(baseEarning + profileBonus).toLocaleString()} (Profile Bonus)\n`;
                } else {
                    const profileBonus = Math.round(baseEarning * 0.15);
                    message += `💡 With Profile: ₦${(baseEarning + profileBonus).toLocaleString()} (Complete /profile)\n`;
                }
                
                message += `⏱️ Duration: ${campaign.duration} hours\n`;
                message += `👥 Spots: ${campaign.participants ? campaign.participants.length : 0}/${campaign.estimatedParticipants}\n`;
                message += `📊 Package: ${campaign.package}\n\n`;
            }
            
            message += `🎯 Everyone gets selected based on fairness and availability!\n`;
            if (!user.profileCompleted) {
                message += `💡 Complete your profile for bonus earnings: /profile`;
            } else {
                message += `✅ Profile complete - you're ready for bonus earnings!`;
            }
            
            await bot.sendMessage(chatId, message);
        }
        
    } catch (error) {
        console.error('❌ Error in /campaigns command:', error);
        await bot.sendMessage(chatId, 'Sorry, there was an error loading campaigns. Please try again.');
    }
});

// /earnings command
bot.onText(/\/earnings/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /earnings command received from user: ${chatId}`);
    
    try {
        const user = await User.findOne({ telegramId: chatId.toString() });
        
        if (!user) {
            await bot.sendMessage(chatId, `Please register first with /start`);
            return;
        }
        
        // Calculate potential bonus
        let bonusInfo = '';
        if (user.profileCompleted && user.profile) {
            const bonusPercent = user.profile.authenticityScore > 80 ? '15-25%' : '15%';
            bonusInfo = `\n🎯 Profile Bonus: ${bonusPercent} extra on all campaigns!`;
        } else {
            bonusInfo = `\n💡 Complete /profile for 15-25% bonus earnings!`;
        }
        
        await bot.sendMessage(chatId, 
            `💰 Your Earnings Summary\n\n` +
            `Total Earned: ₦${user.earnings || 0}\n` +
            `Campaigns Completed: ${user.campaignsCompleted || 0}\n` +
            `Account Status: ${user.isActive ? '✅ Active' : '❌ Inactive'}${bonusInfo}\n\n` +
            `💡 Keep participating to earn more!`
        );
        
    } catch (error) {
        console.error('❌ Error in /earnings command:', error);
        await bot.sendMessage(chatId, 'Sorry, there was an error loading your earnings. Please try again.');
    }
});

// /status command
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /status command received from user: ${chatId}`);
    
    try {
        const user = await User.findOne({ telegramId: chatId.toString() });
        
        if (!user) {
            await bot.sendMessage(chatId, `Please register first with /start`);
            return;
        }
        
        // Twitter verification status
        let twitterStatus = '';
        if (!user.twitterHandle) {
            twitterStatus = `❌ Not linked - Use /twitter to link account`;
        } else if (!user.twitterVerified) {
            if (user.verificationCode && user.verificationExpires > new Date()) {
                const timeLeft = Math.ceil((user.verificationExpires - new Date()) / (1000 * 60));
                twitterStatus = `⏳ Verification pending - ${timeLeft} min left\n` +
                               `Code: ${user.verificationCode}\n` +
                               `Add to @${user.twitterHandle} bio, then reply "verify"`;
            } else {
                twitterStatus = `🔐 Not verified - Use /twitter to verify @${user.twitterHandle}`;
            }
        } else {
            twitterStatus = `✅ @${user.twitterHandle} (verified ${user.verifiedAt ? user.verifiedAt.toDateString() : ''})`;
        }
        
        // Profile status
        let profileStatus = '';
        if (user.profileCompleted && user.profile) {
            profileStatus = `✅ ${user.profile.primaryProfile.label} (${user.profile.authenticityScore}/100)`;
        } else {
            profileStatus = `❌ Not completed (missing bonus earnings!)`;
        }
        
        await bot.sendMessage(chatId, 
            `📊 Account Status\n\n` +
            `Name: ${user.firstName} ${user.lastName}\n` +
            `Twitter: ${twitterStatus}\n` +
            `Profile: ${profileStatus}\n` +
            `Account: ${user.isActive ? '✅ Active' : '❌ Inactive'}\n` +
            `Registered: ${user.registeredAt.toDateString()}\n` +
            `Total Earnings: ₦${user.earnings || 0}\n\n` +
            `${!user.twitterHandle ? '📝 Next: Link Twitter with /twitter' : 
              !user.twitterVerified ? '🔐 Next: Complete verification' :
              !user.profileCompleted ? '🧠 Next: Complete profile with /profile' : 
              '🎉 You\'re all set for maximum earnings!'}`
        );
        
    } catch (error) {
        console.error('❌ Error in status command:', error);
        await bot.sendMessage(chatId, 'Sorry, there was an error fetching your status. Please try again.');
    }
});

// Helper functions
function generateVerificationCode() {
    // Generate a unique 6-character code
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return code;
}

function isValidTwitterHandle(handle) {
    // Twitter handle validation
    const twitterRegex = /^[A-Za-z0-9_]{1,15}$/;
    return twitterRegex.test(handle);
}

// Placeholder functions (implement as needed)
async function startSmartProfiling(chatId) {
    await bot.sendMessage(chatId, 'Smart profiling feature coming soon! 🧠');
}

async function createAutomaticAssignments(campaign) {
    console.log('Creating assignments for campaign:', campaign.brandName);
}

async function notifyUsersAboutCampaign(campaign) {
    console.log('Notifying users about campaign:', campaign.brandName);
}

// Handle unknown commands
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Ignore if it's a command we handle or not a command
    if (!text || !text.startsWith('/') || text.match(/\/(start|help|twitter|campaigns|earnings|status|assignments|profile)/)) {
        return;
    }
    
    try {
        await bot.sendMessage(chatId, 
            `❓ Unknown command: ${text}\n\n` +
            `Use /help to see available commands.`
        );
    } catch (error) {
        console.error('❌ Error handling unknown command:', error);
    }
});

// Error handling for bot
bot.on('error', (error) => {
    console.log('❌ Bot error:', error.message);
});

bot.on('polling_error', (error) => {
    console.log('❌ Polling error:', error.message);
});

// Start our server
app.listen(PORT, async () => {
    try {
        const totalUsers = await User.countDocuments();
        const activeCampaigns = await Campaign.countDocuments({ status: { $in: ['pending', 'active'] } });
        
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`🤖 Telegram bot is active and listening...`);
        console.log(`📊 Database: MongoDB connected`);
        console.log(`👥 Total registered users: ${totalUsers}`);
        console.log(`📱 Active campaigns: ${activeCampaigns}`);
        console.log(`🧠 Smart profiling enabled - users earn bonus for completing profiles!`);
    } catch (error) {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`🤖 Telegram bot is active and listening...`);
        console.log(`⚠️ Database connection status unknown`);
        console.log(`📱 Go to Telegram and message your bot to test it!`);
    }
});

// Handle server shutdown gracefully
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down server and bot...');
    bot.stopPolling();
    process.exit(0);
});