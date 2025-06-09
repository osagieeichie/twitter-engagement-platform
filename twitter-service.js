// twitter-service.js - NEW FILE - Create this file
const axios = require('axios');

class TwitterService {
    constructor() {
        this.bearerToken = process.env.TWITTER_BEARER_TOKEN;
        this.apiKey = process.env.TWITTER_API_KEY;
        this.apiSecret = process.env.TWITTER_API_SECRET;
        this.baseURL = 'https://api.twitter.com/2';
    }

    // Get user profile by username
    async getUserProfile(username) {
        try {
            const response = await axios.get(`${this.baseURL}/users/by/username/${username}`, {
                headers: {
                    'Authorization': `Bearer ${this.bearerToken}`
                },
                params: {
                    'user.fields': 'description,public_metrics,verified,created_at'
                }
            });

            return response.data.data;
        } catch (error) {
            console.error('Twitter API Error:', error.response?.data || error.message);
            throw new Error('Failed to fetch Twitter profile');
        }
    }

    // Verify bio contains verification code
    async verifyBioCode(username, verificationCode) {
        try {
            const userProfile = await this.getUserProfile(username);
            
            if (!userProfile || !userProfile.description) {
                return { verified: false, reason: 'Profile not found or no bio' };
            }

            const bioContainsCode = userProfile.description.includes(verificationCode);
            
            return {
                verified: bioContainsCode,
                profile: userProfile,
                reason: bioContainsCode ? 'Code found in bio' : 'Code not found in bio'
            };
        } catch (error) {
            return { verified: false, reason: error.message };
        }
    }

    // Calculate user engagement value based on metrics
    calculateUserValue(userProfile) {
        const metrics = userProfile.public_metrics;
        const followers = metrics.followers_count;
        const following = metrics.following_count;
        const tweets = metrics.tweet_count;
        
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
                }
            });

            return response.data.data || [];
        } catch (error) {
            console.error('Error fetching tweets:', error.response?.data || error.message);
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
            console.error('Error calculating engagement:', error);
            return 0;
        }
    }
}

module.exports = TwitterService;