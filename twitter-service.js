// twitter-service.js - Updated with better error handling
const axios = require('axios');

class TwitterService {
    constructor() {
        this.bearerToken = process.env.TWITTER_BEARER_TOKEN;
        this.apiKey = process.env.TWITTER_API_KEY;
        this.apiSecret = process.env.TWITTER_API_SECRET;
        this.baseURL = 'https://api.twitter.com/2';
        
        // Log credential status (without exposing actual values)
        console.log('🐦 TwitterService initialized:');
        console.log('  - Bearer Token:', this.bearerToken ? 'Present' : 'Missing');
        console.log('  - API Key:', this.apiKey ? 'Present' : 'Missing');
        console.log('  - API Secret:', this.apiSecret ? 'Present' : 'Missing');
    }

    // Get user profile by username
    async getUserProfile(username) {
        if (!this.bearerToken) {
            throw new Error('Twitter Bearer Token not configured. Please add TWITTER_BEARER_TOKEN to environment variables.');
        }

        try {
            console.log(`🔍 Fetching Twitter profile for: @${username}`);
            
            const response = await axios.get(`${this.baseURL}/users/by/username/${username}`, {
                headers: {
                    'Authorization': `Bearer ${this.bearerToken}`
                },
                params: {
                    'user.fields': 'description,public_metrics,verified,created_at'
                },
                timeout: 10000 // 10 second timeout
            });

            console.log('✅ Twitter profile fetched successfully');
            return response.data.data;
        } catch (error) {
            console.error('❌ Twitter getUserProfile error:', {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                message: error.message
            });
            
            if (error.response?.status === 401) {
                throw new Error('401 Unauthorized: Invalid Twitter API credentials');
            } else if (error.response?.status === 404) {
                throw new Error(`404 Not Found: Twitter user @${username} not found`);
            } else if (error.response?.status === 429) {
                throw new Error('429 Rate Limited: Twitter API requests exceeded. Please wait before trying again.');
            } else {
                throw new Error(`Twitter API Error: ${error.response?.status || 'Unknown'} - ${error.message}`);
            }
        }
    }

    // Verify bio contains verification code
    async verifyBioCode(username, verificationCode) {
        try {
            console.log(`🔍 Verifying bio code for @${username} with code: ${verificationCode}`);
            
            const userProfile = await this.getUserProfile(username);
            
            if (!userProfile || !userProfile.description) {
                console.log('❌ No bio found for user');
                return { 
                    verified: false, 
                    reason: 'Profile not found or no bio',
                    profile: null 
                };
            }

            console.log(`📝 Bio content: "${userProfile.description}"`);
            
            const bioContainsCode = userProfile.description.includes(verificationCode);
            
            console.log(`🔍 Code "${verificationCode}" found in bio: ${bioContainsCode}`);
            
            return {
                verified: bioContainsCode,
                profile: userProfile,
                reason: bioContainsCode ? 'Code found in bio' : 'Code not found in bio'
            };
        } catch (error) {
            console.error('❌ verifyBioCode error:', error.message);
            
            // Re-throw with more context
            throw new Error(`Bio verification failed: ${error.message}`);
        }
    }

    // Calculate user engagement value based on metrics
    calculateUserValue(userProfile) {
        if (!userProfile || !userProfile.public_metrics) {
            return 50; // Default score
        }

        const metrics = userProfile.public_metrics;
        const followers = metrics.followers_count || 0;
        const following = metrics.following_count || 0;
        const tweets = metrics.tweet_count || 0;
        
        // Calculate engagement potential score
        let score = 0;
        
        // Follower score (logarithmic to prevent mega-influencers from dominating)
        score += Math.log10(Math.max(followers, 1)) * 20;
        
        // Follower-to-following ratio (authentic users typically have more followers than following)
        const ratio = following > 0 ? followers / following : followers;
        if (ratio > 1) score += Math.min(ratio * 5, 50);
        
        // Activity score (regular tweeters are more valuable)
        const accountAge = (new Date() - new Date(userProfile.created_at)) / (1000 * 60 * 60 * 24 * 365);
        const tweetsPerYear = tweets / Math.max(accountAge, 0.1);
        score += Math.min(tweetsPerYear / 10, 30);
        
        // Verification bonus
        if (userProfile.verified) score += 25;
        
        return Math.round(Math.max(score, 10)); // Minimum score of 10
    }

    // Get recent tweets to analyze engagement
    async getUserRecentTweets(username, maxResults = 10) {
        try {
            const userProfile = await this.getUserProfile(username);
            const userId = userProfile.id;

            const response = await axios.get(`${this.baseURL}/users/${userId}/tweets`, {
                headers: {
                    'Authorization': `Bearer ${this.bearerToken}`
                },
                params: {
                    'max_results': maxResults,
                    'tweet.fields': 'public_metrics,created_at'
                },
                timeout: 10000
            });

            return response.data.data || [];
        } catch (error) {
            console.error('❌ Error fetching tweets:', error.message);
            return [];
        }
    }

    // Calculate average engagement from recent tweets
    async calculateAverageEngagement(username) {
        try {
            const tweets = await this.getUserRecentTweets(username, 20);
            
            if (tweets.length === 0) return 0;

            const totalEngagement = tweets.reduce((sum, tweet) => {
                const metrics = tweet.public_metrics;
                return sum + metrics.like_count + metrics.retweet_count + metrics.reply_count;
            }, 0);

            return Math.round(totalEngagement / tweets.length);
        } catch (error) {
            console.error('❌ Error calculating engagement:', error);
            return 0;
        }
    }
}

module.exports = TwitterService;