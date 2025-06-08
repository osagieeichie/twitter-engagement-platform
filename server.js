// server.js - Twitter Engagement Platform with Smart Profiling
require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// Get bot token from environment (try multiple ways)
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;

// Debug: Log what we're getting
console.log('🔍 Environment check:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('BOT_TOKEN exists:', !!BOT_TOKEN);
console.log('BOT_TOKEN length:', BOT_TOKEN ? BOT_TOKEN.length : 0);

// Check if we have the bot token
if (!BOT_TOKEN) {
    console.log('❌ ERROR: TELEGRAM_BOT_TOKEN not found in environment variables');
    console.log('Available env vars:', Object.keys(process.env).filter(key => key.includes('TOKEN')));
    process.exit(1);
}

// Create Telegram bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// This lets our server understand JSON data
app.use(express.json());

// Store users in memory for now (later we'll use a database)
let users = [];
let campaigns = [];
let assignments = [];
let cooldowns = {}; // Track user cooldowns
let userProfilingStates = {}; // Track profiling progress

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
        question: "What best describes your typical weekday?",
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
        question: "How do you typically discover new products/services?",
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
app.get('/', (req, res) => {
    res.json({ 
        message: 'Welcome to Twitter Engagement Platform with Smart Profiling!',
        status: 'Server is running',
        totalUsers: users.length,
        activeCampaigns: campaigns.length,
        completedProfiles: users.filter(u => u.profileCompleted).length
    });
});

// Serve the dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/dashboard.html');
});

// API route to create campaigns
app.post('/api/campaigns/create', (req, res) => {
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
        const newCampaign = {
            id: Date.now().toString(),
            ...campaignData,
            status: 'pending',
            createdAt: new Date(),
            participants: [],
            totalEngagement: 0
        };
        
        // Add to campaigns array
        campaigns.push(newCampaign);
        
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
            campaignId: newCampaign.id
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
app.get('/api/campaigns', (req, res) => {
    res.json({
        success: true,
        campaigns: campaigns.map(campaign => ({
            id: campaign.id,
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
});

app.get('/users', (req, res) => {
    res.json({ 
        message: 'Registered Users',
        users: users.map(user => ({
            name: user.firstName,
            telegramId: user.telegramId,
            profile: user.profileCompleted ? user.profile.primaryProfile.label : 'Not completed',
            isActive: user.isActive || false
        }))
    });
});

// Smart Assignment System (Inclusive Approach)
function createAutomaticAssignments(campaign) {
    console.log(`🤖 Creating assignments for: ${campaign.brandName}`);
    
    // Get ALL available users (regardless of profile status)
    const availableUsers = getAvailableUsers();
    
    if (availableUsers.length === 0) {
        console.log('⚠️ No available users for assignments');
        return;
    }
    
    // Select users - everyone gets a fair chance
    const maxParticipants = Math.min(availableUsers.length, campaign.estimatedParticipants);
    const selectedUsers = selectBestUsersInclusive(availableUsers, maxParticipants);
    
    // Distribute roles (profile helps but isn't required)
    const roleDistribution = distributeRolesInclusive(selectedUsers, campaign);
    
    // Create assignments with organic timing
    const campaignAssignments = createTimedAssignments(campaign, roleDistribution);
    
    // Store assignments
    assignments.push(...campaignAssignments);
    
    // Update campaign with participants
    campaign.participants = selectedUsers.map(user => user.telegramId);
    campaign.status = 'active';
    
    // Notify selected users
    notifySelectedUsersInclusive(campaignAssignments);
    
    console.log(`✅ Created ${campaignAssignments.length} assignments for ${selectedUsers.length} users`);
    console.log(`📊 ${selectedUsers.filter(u => u.profileCompleted).length} users have completed profiles (bonus earnings!)`);
}

function getAvailableUsers() {
    const now = new Date();
    
    return users.filter(user => {
        // Must have Twitter account and be active
        if (!user.twitterHandle || !user.isActive) return false;
        
        // Check cooldown
        const userCooldown = cooldowns[user.telegramId];
        if (userCooldown && now < userCooldown.until) return false;
        
        return true;
    });
}

function selectBestUsersInclusive(availableUsers, maxParticipants) {
    // Fair selection - everyone gets a chance, profile just adds bonus points
    const scoredUsers = availableUsers.map(user => {
        const timeSinceLastParticipation = getTimeSinceLastParticipation(user);
        const engagementScore = user.engagementRate || 5; // Default engagement rate
        
        // Base score (same for everyone)
        let score = (engagementScore * 0.6) + (timeSinceLastParticipation * 0.4);
        
        // Small profile bonus (not game-changing)
        if (user.profileCompleted) {
            score += 1; // Just a small boost, not decisive
        }
        
        return { ...user, score };
    });
    
    // Sort by score but ensure fairness
    return scoredUsers
        .sort((a, b) => b.score - a.score)
        .slice(0, maxParticipants);
}

function getTimeSinceLastParticipation(user) {
    const now = new Date();
    const lastParticipation = user.lastParticipation || new Date(user.registeredAt);
    const hoursSince = (now - lastParticipation) / (1000 * 60 * 60);
    
    // Normalize to 0-10 scale (more hours = higher score)
    return Math.min(10, hoursSince / 24);
}

function distributeRolesInclusive(selectedUsers, campaign) {
    const distribution = [];
    
    selectedUsers.forEach(user => {
        // Get role suggestion (profile helps but defaults to fair distribution)
        const role = getRoleForUserInclusive(user, campaign);
        distribution.push({
            user: user,
            role: role,
            hasProfile: user.profileCompleted || false,
            profileMatch: user.profileCompleted ? isUserMatchForCampaign(user, campaign) : false
        });
    });
    
    // Ensure balanced role distribution
    return balanceRoleDistributionFairly(distribution);
}

function getRoleForUserInclusive(user, campaign) {
    // If user has profile, use smart assignment
    if (user.profileCompleted && user.profile) {
        const profile = user.profile.primaryProfile;
        const authenticity = user.profile.authenticityScore;
        
        // High authenticity users get better roles
        if (authenticity > 85) {
            return Math.random() > 0.5 ? 'initiator' : 'quoter';
        }
        
        // Profile-based suggestions
        if (profile.label.includes('Student') || profile.label.includes('Creative')) {
            return Math.random() > 0.6 ? 'replier' : 'quoter';
        }
        
        if (profile.label.includes('Professional') || profile.label.includes('Entrepreneur')) {
            return Math.random() > 0.5 ? 'retweeter' : 'replier';
        }
    }
    
    // Default fair distribution for everyone
    const roles = ['initiator', 'replier', 'retweeter', 'quoter'];
    return roles[Math.floor(Math.random() * roles.length)];
}

function balanceRoleDistributionFairly(distribution) {
    // Simple rotation to ensure everyone gets different roles over time
    const totalUsers = distribution.length;
    const targetCounts = {
        initiator: Math.ceil(totalUsers * 0.2),
        replier: Math.ceil(totalUsers * 0.4),
        retweeter: Math.ceil(totalUsers * 0.25),
        quoter: Math.ceil(totalUsers * 0.15)
    };
    
    // Adjust to fit total users
    const totalRoles = Object.values(targetCounts).reduce((sum, count) => sum + count, 0);
    if (totalRoles > totalUsers) {
        targetCounts.replier = Math.max(1, targetCounts.replier - (totalRoles - totalUsers));
    }
    
    // Redistribute fairly while respecting preferences
    const finalDistribution = [];
    
    // Assign initiators first (give to high authenticity if available)
    const highAuthUsers = distribution.filter(d => d.hasProfile && d.user.profile.authenticityScore > 80);
    let initiatorsAssigned = 0;
    
    for (let i = 0; i < Math.min(targetCounts.initiator, highAuthUsers.length); i++) {
        finalDistribution.push({
            ...highAuthUsers[i],
            role: 'initiator'
        });
        initiatorsAssigned++;
    }
    
    // Fill remaining roles fairly
    const remainingUsers = distribution.filter(d => !finalDistribution.some(fd => fd.user.telegramId === d.user.telegramId));
    const remainingRoles = [];
    
    // Add remaining initiators
    for (let i = initiatorsAssigned; i < targetCounts.initiator; i++) {
        remainingRoles.push('initiator');
    }
    
    // Add other roles
    for (let i = 0; i < targetCounts.replier; i++) remainingRoles.push('replier');
    for (let i = 0; i < targetCounts.retweeter; i++) remainingRoles.push('retweeter');
    for (let i = 0; i < targetCounts.quoter; i++) remainingRoles.push('quoter');
    
    // Shuffle roles for fairness
    for (let i = remainingRoles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remainingRoles[i], remainingRoles[j]] = [remainingRoles[j], remainingRoles[i]];
    }
    
    // Assign remaining roles
    remainingUsers.forEach((assignment, index) => {
        finalDistribution.push({
            ...assignment,
            role: remainingRoles[index] || 'replier'
        });
    });
    
    return finalDistribution;
}

function isUserMatchForCampaign(user, campaign) {
    if (!user.profile || !user.profileCompleted) return false;
    
    const userProfile = user.profile.primaryProfile;
    
    // Check if campaign has target audience
    if (campaign.targetAudience) {
        const targetLower = campaign.targetAudience.toLowerCase();
        const profileLower = userProfile.label.toLowerCase();
        
        // Check for keyword matches
        if (targetLower.includes('student') && profileLower.includes('student')) return true;
        if (targetLower.includes('tech') && profileLower.includes('tech')) return true;
        if (targetLower.includes('professional') && profileLower.includes('professional')) return true;
        if (targetLower.includes('creative') && profileLower.includes('creative')) return true;
        if (targetLower.includes('entrepreneur') && profileLower.includes('entrepreneur')) return true;
    }
    
    // Check spending power match
    if (campaign.package === 'premium' && user.profile.spendingPower === 'high') return true;
    if (campaign.package === 'starter' && user.profile.spendingPower === 'emerging') return true;
    
    // High authenticity users match well with any campaign
    if (user.profile.authenticityScore > 85) return true;
    
    return false;
}

function createTimedAssignments(campaign, roleDistribution) {
    const now = new Date();
    const assignments = [];
    
    roleDistribution.forEach((assignment, index) => {
        const baseDelay = getBaseDelayForRole(assignment.role);
        const randomDelay = Math.random() * 60; // Random 0-60 minutes
        const totalDelay = baseDelay + randomDelay;
        
        const scheduledTime = new Date(now.getTime() + (totalDelay * 60 * 1000));
        
        const newAssignment = {
            id: `${campaign.id}_${assignment.user.telegramId}_${Date.now()}`,
            campaignId: campaign.id,
            userId: assignment.user.telegramId,
            user: assignment.user,
            role: assignment.role,
            scheduledTime: scheduledTime,
            status: 'pending',
            content: generateContentForRole(campaign, assignment.role),
            estimatedEarning: calculateEarning(campaign, assignment.role),
            isProfileMatch: assignment.profileMatch || false
        };
        
        assignments.push(newAssignment);
    });
    
    return assignments;
}

function getBaseDelayForRole(role) {
    // Different roles start at different times for organic flow
    const delays = {
        initiator: 0,      // Start immediately
        replier: 30,       // 30 minutes after initiators
        retweeter: 60,     // 1 hour
        quoter: 90         // 1.5 hours
    };
    
    return delays[role] || 0;
}

function generateContentForRole(campaign, role) {
    const templates = {
        initiator: [
            `Anyone else heard of ${campaign.brandName}? 🤔`,
            `Just discovered ${campaign.brandName} - thoughts?`,
            `What's everyone's take on ${campaign.brandName}?`,
            `Has anyone tried ${campaign.brandName}? Worth it?`
        ],
        replier: [
            `I've been using it for a while now, pretty solid!`,
            `Yeah, heard good things about them`,
            `My friend recommended it to me recently`,
            `Definitely worth checking out`
        ],
        retweeter: [
            `Sharing this - interesting discussion!`,
            `Worth a look 👀`,
            `Good thread here`,
            `This caught my attention`
        ],
        quoter: [
            `Adding my 2 cents - been following them for a while`,
            `This aligns with what I've been seeing`,
            `Interesting perspective here`,
            `Worth the conversation`
        ]
    };
    
    const roleTemplates = templates[role] || templates.initiator;
    return roleTemplates[Math.floor(Math.random() * roleTemplates.length)];
}

function calculateEarning(campaign, role) {
    const baseRates = {
        initiator: 300,
        replier: 200,
        retweeter: 100,
        quoter: 250
    };
    
    const totalBudget = campaign.budget * 0.65; // 65% goes to users
    const basePayout = totalBudget / campaign.estimatedParticipants;
    const roleMultiplier = baseRates[role] / 200; // Normalize around 200
    
    return Math.round(basePayout * roleMultiplier);
}

async function notifySelectedUsersInclusive(assignments) {
    for (const assignment of assignments) {
        try {
            const campaign = getCampaignById(assignment.campaignId);
            const user = assignment.user;
            
            // Base earning for everyone
            let earning = assignment.estimatedEarning;
            let bonusMessage = '';
            
            // Profile bonus (nice to have, not essential)
            if (user.profileCompleted && user.profile) {
                const profileBonus = Math.round(earning * 0.15); // 15% bonus for having profile
                
                if (assignment.isProfileMatch && user.profile.authenticityScore > 80) {
                    const matchBonus = Math.round(earning * 0.1); // Additional 10% for perfect match
                    earning += profileBonus + matchBonus;
                    bonusMessage = `\n🎯 Profile Bonus: +₦${(profileBonus + matchBonus).toLocaleString()}! (Profile + Match)`;
                } else if (user.profile.authenticityScore > 80) {
                    earning += profileBonus;
                    bonusMessage = `\n💡 Profile Bonus: +₦${profileBonus.toLocaleString()}! (Completed profile)`;
                }
            }
            
            let message = `🎉 YOU'VE BEEN SELECTED!\n\n` +
                         `Campaign: ${campaign.brandName}\n` +
                         `Your Role: ${assignment.role.toUpperCase()}\n` +
                         `💰 Total Earning: ₦${earning.toLocaleString()}${bonusMessage}\n` +
                         `⏰ Scheduled: ${assignment.scheduledTime.toLocaleString()}\n\n`;
            
            if (user.profileCompleted && user.profile) {
                message += `🧠 Your Profile: ${user.profile.primaryProfile.label}\n` +
                          `⭐ Authenticity: ${user.profile.authenticityScore}/100\n\n`;
            } else {
                message += `💡 Complete your profile with /profile for bonus earnings!\n\n`;
            }
            
            message += `📝 Suggested Content:\n"${assignment.content}"\n\n` +
                      `💡 Customize this message to match your style!`;
            
            await bot.sendMessage(assignment.userId, message);
            
            // Update earning to include bonus
            assignment.estimatedEarning = earning;
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
            
        } catch (error) {
            console.log(`❌ Failed to notify user ${assignment.user.firstName}: ${error.message}`);
        }
    }
}

function getCampaignById(campaignId) {
    return campaigns.find(c => c.id === campaignId);
}

function addUserToCooldown(userId, campaignSize) {
    const now = new Date();
    const baseHours = ASSIGNMENT_CONFIG.cooldownHours.base;
    const maxHours = ASSIGNMENT_CONFIG.cooldownHours.max;
    const minHours = ASSIGNMENT_CONFIG.cooldownHours.min;
    
    // Larger campaigns = longer cooldown
    const sizeMultiplier = Math.min(2, campaignSize / 50);
    const cooldownHours = Math.max(minHours, Math.min(maxHours, baseHours * sizeMultiplier));
    
    cooldowns[userId] = {
        until: new Date(now.getTime() + (cooldownHours * 60 * 60 * 1000)),
        hours: cooldownHours
    };
    
    console.log(`⏰ User ${userId} in cooldown for ${cooldownHours} hours`);
}

// Function to notify users about new campaigns
async function notifyUsersAboutCampaign(campaign) {
    const activeUsers = users.filter(user => user.isActive && user.twitterHandle);
    
    if (activeUsers.length === 0) {
        console.log('⚠️ No active users with Twitter accounts to notify');
        return;
    }
    
    const message = 
        `🚀 NEW CAMPAIGN ALERT!\n\n` +
        `Brand: ${campaign.brandName}\n` +
        `💰 Budget: ₦${campaign.budget.toLocaleString()}\n` +
        `👥 Participants needed: ${campaign.estimatedParticipants}\n` +
        `⏱️ Duration: ${campaign.duration} hours\n` +
        `📊 Estimated reach: ${formatNumber(campaign.estimatedReach)}\n\n` +
        `💡 ${campaign.description.substring(0, 100)}...\n\n` +
        `🤖 Smart assignments are being created!\n` +
        `Complete your profile for better matches: /profile`;
    
    let notified = 0;
    
    for (const user of activeUsers) {
        try {
            await bot.sendMessage(user.telegramId, message);
            notified++;
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            console.log(`❌ Failed to notify user ${user.firstName}: ${error.message}`);
        }
    }
    
    console.log(`📢 Notified ${notified}/${activeUsers.length} users about new campaign`);
}

// Helper function to format numbers
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

// Telegram Bot Commands

// /start command - Register new user
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    // Check if user already exists
    const existingUser = users.find(u => u.telegramId === chatId);
    
    if (existingUser) {
        bot.sendMessage(chatId, `Welcome back, ${user.first_name}! 👋\n\nUse /help to see available commands.`);
        return;
    }
    
    // Add new user
    const newUser = {
        telegramId: chatId,
        firstName: user.first_name,
        lastName: user.last_name || '',
        username: user.username || '',
        registeredAt: new Date(),
        isActive: true,
        earnings: 0,
        campaigns: 0,
        profileCompleted: false
    };
    
    users.push(newUser);
    
    bot.sendMessage(chatId, 
        `🎉 Welcome to Twitter Engagement Platform, ${user.first_name}!\n\n` +
        `You're now registered and ready to earn money from Twitter engagement!\n\n` +
        `📱 Next steps:\n` +
        `1. Link your Twitter account with /twitter\n` +
        `2. Complete your smart profile (2 minutes)\n` +
        `3. Get matched with perfect campaigns!\n\n` +
        `💰 Users with completed profiles earn 20% more!`
    );
    
    console.log(`✅ New user registered: ${user.first_name} (${chatId})`);
});

// /help command
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, 
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
});

// /twitter command with optional profiling
bot.onText(/\/twitter/, (msg) => {
    const chatId = msg.chat.id;
    
    bot.sendMessage(chatId, 
        `🐦 Link Your Twitter Account\n\n` +
        `To participate in campaigns, we need your Twitter handle.\n\n` +
        `Please reply with your Twitter username (without @):\n` +
        `Example: john_doe\n\n` +
        `📝 Type your Twitter handle:`
    );
    
    // Wait for next message from this user
    bot.once('message', (response) => {
        if (response.chat.id === chatId && !response.text.startsWith('/')) {
            const twitterHandle = response.text.trim().replace('@', '');
            
            // Update user with Twitter handle
            const userIndex = users.findIndex(u => u.telegramId === chatId);
            if (userIndex !== -1) {
                users[userIndex].twitterHandle = twitterHandle;
                
                bot.sendMessage(chatId, 
                    `✅ Twitter account linked: @${twitterHandle}\n\n` +
                    `🎉 You're now ready to participate in campaigns!\n\n` +
                    `💡 Optional: Complete a 2-minute profile for 15-25% bonus earnings!\n\n` +
                    `Reply "yes" to start the profile, or use /campaigns to see available opportunities.`
                );
                
                // Wait for profile decision
                bot.once('message', (profileResponse) => {
                    if (profileResponse.chat.id === chatId && 
                        profileResponse.text.toLowerCase().includes('yes')) {
                        
                        bot.sendMessage(chatId, 
                            `🧠 Great! Let's create your smart profile for bonus earnings!\n\n` +
                            `This helps us match you with campaigns you'll actually enjoy.`
                        );
                        
                        setTimeout(() => {
                            startSmartProfiling(chatId);
                        }, 2000);
                    } else {
                        bot.sendMessage(chatId, 
                            `✅ No problem! You're all set to participate in campaigns.\n\n` +
                            `Use /campaigns to see available opportunities.\n` +
                            `You can complete your profile anytime with /profile for bonus earnings!`
                        );
                    }
                });
                
                console.log(`📱 User ${users[userIndex].firstName} linked Twitter: @${twitterHandle}`);
            }
        }
    });
});

// Smart Profiling System (Optional)
function startSmartProfiling(chatId) {
    userProfilingStates[chatId] = {
        currentQuestion: 0,
        answers: {},
        questionOrder: ['age_range', 'daily_routine', 'spending_priority', 'influence_style', 'discovery_style']
    };
    
    askProfilingQuestion(chatId);
}

function askProfilingQuestion(chatId) {
    const state = userProfilingStates[chatId];
    const questionKey = state.questionOrder[state.currentQuestion];
    const question = PROFILING_QUESTIONS[questionKey];
    
    if (!question) {
        // Profiling complete
        completeUserProfile(chatId);
        return;
    }
    
    const questionNumber = state.currentQuestion + 1;
    const totalQuestions = state.questionOrder.length;
    
    let message = `📊 Profile Question ${questionNumber}/${totalQuestions}\n\n`;
    message += `${question.question}\n\n`;
    
    // Create inline keyboard with options
    const keyboard = question.options.map((option, index) => [
        { text: `${index + 1}. ${option}`, callback_data: `profile_${questionKey}_${index}` }
    ]);
    
    bot.sendMessage(chatId, message, {
        reply_markup: {
            inline_keyboard: keyboard
        }
    });
}

// Handle profiling answers
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    if (data.startsWith('profile_')) {
        const [, questionKey, optionIndex] = data.split('_');
        const state = userProfilingStates[chatId];
        
        if (state) {
            const question = PROFILING_QUESTIONS[questionKey];
            const selectedOption = question.options[parseInt(optionIndex)];
            
            // Store answer
            state.answers[questionKey] = selectedOption;
            
            // Acknowledge selection
            bot.editMessageText(
                `✅ ${question.question}\n\nYour answer: ${selectedOption}`,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id
                }
            );
            
            // Move to next question
            state.currentQuestion++;
            
            setTimeout(() => {
                askProfilingQuestion(chatId);
            }, 1500);
        }
    }
    
    bot.answerCallbackQuery(query.id);
});

function completeUserProfile(chatId) {
    const state = userProfilingStates[chatId];
    const answers = state.answers;
    
    // Generate user persona
    const persona = generateUserPersona(answers);
    
    // Update user in database
    const userIndex = users.findIndex(u => u.telegramId === chatId);
    if (userIndex !== -1) {
        users[userIndex].profile = persona;
        users[userIndex].profileCompleted = true;
        users[userIndex].profileCompletedAt = new Date();
    }
    
    // Send personalized completion message
    const completionMessage = generateCompletionMessage(persona);
    
    bot.sendMessage(chatId, completionMessage);
    
    // Clean up profiling state
    delete userProfilingStates[chatId];
    
    console.log(`🧠 Profile completed for user ${chatId}: ${persona.primaryProfile.label}`);
}

function generateUserPersona(answers) {
    // Generate persona based on answers
    const persona = {
        primaryProfile: determineProfile(answers),
        spendingPower: determineSpendingPower(answers),
        authenticityScore: determineAuthenticity(answers),
        marketingValue: "high"
    };
    
    persona.recommendedCampaignTypes = getRecommendedCampaigns(persona, answers);
    
    return persona;
}

function determineProfile(answers) {
    const routine = answers.daily_routine || "";
    const spending = answers.spending_priority || "";
    const influence = answers.influence_style || "";
    
    // Smart profile matching
    if (routine.includes("Classes") && spending.includes("gadgets")) {
        return {
            label: "Tech-Savvy Student",
            description: "University students passionate about technology and gadgets",
            bestFor: ["tech_products", "educational_apps", "student_services"],
            authenticityLevel: "very_high"
        };
    }
    
    if (routine.includes("Classes") && spending.includes("Basic needs")) {
        return {
            label: "Budget-Smart Student",
            description: "Students who prioritize value and affordability", 
            bestFor: ["affordable_products", "student_discounts", "value_services"],
            authenticityLevel: "very_high"
        };
    }
    
    if (routine.includes("Office") && spending.includes("Fashion")) {
        return {
            label: "Style-Conscious Professional",
            description: "Young professionals who care about image and status",
            bestFor: ["fashion", "premium_products", "professional_services"],
            authenticityLevel: "high"
        };
    }
    
    if (routine.includes("business") && spending.includes("Skills")) {
        return {
            label: "Growth-Focused Entrepreneur", 
            description: "Business-minded individuals focused on growth and learning",
            bestFor: ["business_tools", "productivity_apps", "courses"],
            authenticityLevel: "high"
        };
    }
    
    if (routine.includes("Creative") && influence.includes("genuinely love")) {
        return {
            label: "Passionate Creative",
            description: "Artists and creators who genuinely love what they share",
            bestFor: ["creative_tools", "artistic_products", "unique_brands"],
            authenticityLevel: "very_high"
        };
    }
    
    if (routine.includes("Job hunting") && influence.includes("value for money")) {
        return {
            label: "Honest Value Advisor",
            description: "Job seekers who give very honest opinions about value",
            bestFor: ["affordable_products", "job_services", "skill_development"],
            authenticityLevel: "very_high"
        };
    }
    
    // Default profile
    return {
        label: "Authentic Influencer",
        description: "Genuine social media user with authentic voice",
        bestFor: ["general_products", "lifestyle_brands"],
        authenticityLevel: "high"
    };
}

function determineSpendingPower(answers) {
    const age = answers.age_range || "";
    const routine = answers.daily_routine || "";
    const spending = answers.spending_priority || "";
    
    if (routine.includes("Classes") || spending.includes("Basic needs")) {
        return "emerging";
    }
    
    if (routine.includes("business") || spending.includes("investments")) {
        return "high";
    }
    
    if (routine.includes("Office") && (age.includes("26-30") || age.includes("31-35"))) {
        return "moderate_to_high";
    }
    
    return "moderate";
}

function determineAuthenticity(answers) {
    let score = 70; // Base score
    
    const influence = answers.influence_style || "";
    const discovery = answers.discovery_style || "";
    const routine = answers.daily_routine || "";
    
    if (influence.includes("genuinely love")) score += 20;
    if (influence.includes("solved a real problem")) score += 15;
    if (discovery.includes("friends and people I trust")) score += 10;
    if (routine.includes("Classes") || routine.includes("Job hunting")) score += 15;
    
    return Math.min(100, score);
}

function getRecommendedCampaigns(persona, answers) {
    const campaigns = [];
    
    // Add campaign types based on profile
    if (persona.primaryProfile.bestFor.includes("tech_products")) {
        campaigns.push("Tech & Gadgets", "Apps & Software", "Educational Technology");
    }
    
    if (persona.spendingPower === "high") {
        campaigns.push("Premium Brands", "Luxury Products", "Investment Services");
    }
    
    if (persona.authenticityScore > 85) {
        campaigns.push("Authentic Reviews", "Personal Experience Sharing", "Honest Testimonials");
    }
    
    if (persona.primaryProfile.bestFor.includes("affordable_products")) {
        campaigns.push("Budget-Friendly Products", "Student Discounts", "Value Services");
    }
    
    return campaigns.slice(0, 5); // Limit to top 5
}

function generateCompletionMessage(persona) {
    return `🎉 Profile Complete!\n\n` +
           `Your Profile: **${persona.primaryProfile.label}**\n` +
           `${persona.primaryProfile.description}\n\n` +
           `💰 Spending Power: ${persona.spendingPower.replace('_', ' ').toUpperCase()}\n` +
           `🎯 Authenticity Score: ${persona.authenticityScore}/100\n\n` +
           `✨ You're perfect for these campaign types:\n` +
           persona.recommendedCampaignTypes.map(type => `• ${type}`).join('\n') + '\n\n' +
           `💰 Earnings Boost: You'll now earn 15-25% more on campaigns!\n\n` +
           `🚀 You're all set! Use /campaigns to see what's available!`;
}

// /profile command - View or complete profile
bot.onText(/\/profile/, (msg) => {
    const chatId = msg.chat.id;
    const user = users.find(u => u.telegramId === chatId);
    
    if (!user) {
        bot.sendMessage(chatId, `Please register first with /start`);
        return;
    }
    
    if (!user.twitterHandle) {
        bot.sendMessage(chatId, 
            `🐦 Please link your Twitter account first!\n\n` +
            `Use /twitter to link your account.`
        );
        return;
    }
    
    if (!user.profileCompleted) {
        bot.sendMessage(chatId, 
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
        bot.once('message', (response) => {
            if (response.chat.id === chatId && 
                response.text.toLowerCase().includes('start')) {
                
                startSmartProfiling(chatId);
            }
        });
        
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
    
    bot.sendMessage(chatId, message);
    
    // Allow profile retaking
    bot.once('message', (response) => {
        if (response.chat.id === chatId && 
            response.text.toLowerCase().includes('retake')) {
            
            bot.sendMessage(chatId, `🔄 Retaking profile questionnaire...`);
            
            setTimeout(() => {
                startSmartProfiling(chatId);
            }, 1000);
        }
    });
});

// /campaigns command - Show campaigns to everyone
bot.onText(/\/campaigns/, (msg) => {
    const chatId = msg.chat.id;
    const user = users.find(u => u.telegramId === chatId);
    
    if (!user) {
        bot.sendMessage(chatId, `Please register first with /start`);
        return;
    }
    
    if (!user.twitterHandle) {
        bot.sendMessage(chatId, 
            `🐦 Please link your Twitter account first!\n\n` +
            `Use /twitter to link your account and start earning!`
        );
        return;
    }
    
    const availableCampaigns = campaigns.filter(c => c.status === 'pending' || c.status === 'active');
    
    if (availableCampaigns.length === 0) {
        let message = `📋 No Active Campaigns\n\n` +
                     `There are no campaigns available right now.\n` +
                     `New campaigns are posted regularly!\n\n`;
        
        if (user.profileCompleted) {
            message += `💡 Your profile: ${user.profile.primaryProfile.label}\n` +
                      `You'll get priority for: ${user.profile.recommendedCampaignTypes.slice(0, 2).join(', ')}`;
        } else {
            message += `💡 Complete your profile with /twitter for bonus earnings!`;
        }
        
        bot.sendMessage(chatId, message);
    } else {
        let message = `🚀 Available Campaigns:\n\n`;
        
        availableCampaigns.forEach((campaign, index) => {
            const baseEarning = Math.round(campaign.budget * 0.65 / campaign.estimatedParticipants);
            
            message += `${index + 1}. ${campaign.brandName}\n`;
            message += `💰 Base Earning: ₦${baseEarning.toLocaleString()}\n`;
            
            // Show potential bonuses
            if (user.profileCompleted) {
                const profileBonus = Math.round(baseEarning * 0.15);
                const isMatch = isUserMatchForCampaign(user, campaign);
                
                if (isMatch && user.profile.authenticityScore > 80) {
                    const totalBonus = Math.round(baseEarning * 0.25);
                    message += `🎯 Your Potential: ₦${(baseEarning + totalBonus).toLocaleString()} (Perfect Match!)\n`;
                } else {
                    message += `💡 Your Potential: ₦${(baseEarning + profileBonus).toLocaleString()} (Profile Bonus)\n`;
                }
            } else {
                const profileBonus = Math.round(baseEarning * 0.15);
                message += `💡 With Profile: ₦${(baseEarning + profileBonus).toLocaleString()} (Complete /twitter)\n`;
            }
            
            message += `⏱️ Duration: ${campaign.duration} hours\n`;
            message += `👥 Spots: ${campaign.participants.length}/${campaign.estimatedParticipants}\n`;
            message += `📊 Package: ${campaign.package}\n\n`;
        });
        
        message += `🎯 Everyone gets selected based on fairness and availability!\n`;
        if (!user.profileCompleted) {
            message += `💡 Complete your profile for bonus earnings: /twitter`;
        } else {
            message += `✅ Profile complete - you're ready for bonus earnings!`;
        }
        
        bot.sendMessage(chatId, message);
    }
});

// /assignments command - Check your current assignments
bot.onText(/\/assignments/, (msg) => {
    const chatId = msg.chat.id;
    const user = users.find(u => u.telegramId === chatId);
    
    if (!user) {
        bot.sendMessage(chatId, `Please register first with /start`);
        return;
    }
    
    const userAssignments = assignments.filter(a => a.userId === chatId);
    
    if (userAssignments.length === 0) {
        let message = `📋 No Current Assignments\n\n` +
                     `You don't have any active assignments right now.\n` +
                     `Make sure your Twitter account is linked with /twitter!\n\n`;
        
        if (!user.profileCompleted) {
            message += `💡 Complete your profile for bonus earnings: /profile`;
        } else {
            message += `✅ Profile complete - you're ready for campaigns!`;
        }
        
        bot.sendMessage(chatId, message);
        return;
    }
    
    let message = `📋 Your Active Assignments:\n\n`;
    
    userAssignments.forEach((assignment, index) => {
        const campaign = getCampaignById(assignment.campaignId);
        const timeUntil = getTimeUntilScheduled(assignment.scheduledTime);
        
        message += `${index + 1}. ${campaign.brandName}\n`;
        message += `Role: ${assignment.role.toUpperCase()}\n`;
        message += `💰 Earning: ₦${assignment.estimatedEarning.toLocaleString()}\n`;
        message += `⏰ ${timeUntil}\n`;
        message += `Status: ${assignment.status === 'pending' ? '⏳ Scheduled' : assignment.status}\n\n`;
    });
    
    message += `💡 We'll remind you 15 minutes before each assignment!`;
    
    bot.sendMessage(chatId, message);
});

function getTimeUntilScheduled(scheduledTime) {
    const now = new Date();
    const timeDiff = scheduledTime - now;
    
    if (timeDiff < 0) {
        return '🔴 Overdue';
    }
    
    const hours = Math.floor(timeDiff / (1000 * 60 * 60));
    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
        return `in ${hours}h ${minutes}m`;
    } else {
        return `in ${minutes}m`;
    }
}

// /earnings command
bot.onText(/\/earnings/, (msg) => {
    const chatId = msg.chat.id;
    const user = users.find(u => u.telegramId === chatId);
    
    if (!user) {
        bot.sendMessage(chatId, `Please register first with /start`);
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
    
    bot.sendMessage(chatId, 
        `💰 Your Earnings Summary\n\n` +
        `Total Earned: ₦${user.earnings || 0}\n` +
        `Campaigns Completed: ${user.campaigns || 0}\n` +
        `Account Status: ${user.isActive ? '✅ Active' : '❌ Inactive'}${bonusInfo}\n\n` +
        `💡 Keep participating to earn more!`
    );
});

// /status command
bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    const user = users.find(u => u.telegramId === chatId);
    
    if (!user) {
        bot.sendMessage(chatId, `Please register first with /start`);
        return;
    }
    
    let profileStatus = '';
    if (user.profileCompleted && user.profile) {
        profileStatus = `✅ ${user.profile.primaryProfile.label} (${user.profile.authenticityScore}/100)`;
    } else {
        profileStatus = `❌ Not completed (missing bonus earnings!)`;
    }
    
    bot.sendMessage(chatId, 
        `📊 Account Status\n\n` +
        `Name: ${user.firstName} ${user.lastName}\n` +
        `Twitter: ${user.twitterHandle ? '@' + user.twitterHandle : '❌ Not linked'}\n` +
        `Profile: ${profileStatus}\n` +
        `Status: ${user.isActive ? '✅ Active' : '❌ Inactive'}\n` +
        `Registered: ${user.registeredAt.toDateString()}\n` +
        `Total Earnings: ₦${user.earnings || 0}\n\n` +
        `${!user.twitterHandle ? '📝 Link your Twitter with /twitter' : 
          !user.profileCompleted ? '🧠 Complete your profile with /profile for bonuses' : 
          '🎉 You\'re all set for maximum earnings!'}`
    );
});

// Handle unknown commands
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Ignore if it's a command we handle or not a command
    if (!text || !text.startsWith('/') || text.match(/\/(start|help|twitter|campaigns|earnings|status|assignments|profile)/)) {
        return;
    }
    
    bot.sendMessage(chatId, 
        `❓ Unknown command: ${text}\n\n` +
        `Use /help to see available commands.`
    );
});

// Error handling for bot
bot.on('error', (error) => {
    console.log('❌ Bot error:', error.message);
});

bot.on('polling_error', (error) => {
    console.log('❌ Polling error:', error.message);
});

// Start our server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🤖 Telegram bot is active and listening...`);
    console.log(`👥 Total registered users: ${users.length}`);
    console.log(`📱 Go to Telegram and message your bot to test it!`);
    console.log(`🧠 Smart profiling enabled - users earn bonus for completing profiles!`);
});

// Handle server shutdown gracefully
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down server and bot...');
    bot.stopPolling();
    process.exit(0);
});