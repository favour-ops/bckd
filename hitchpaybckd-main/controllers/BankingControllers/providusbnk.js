const {
    genProvidusAccount
    
} = require('./_dependencies');


const genPRVAccount = async (req, res) => {
    console.log('Initiated account setup')
    try {
        const userid = 1;
        const bvvn = '23232890202';
        var createAccount = await genProvidusAccount(userid, bvvn);

        return createAccount;
    
    } catch (error) {
        console.log('error', error)
        // logger.error('genProvidusAccount Error:', error.response ? error.response.data : error.message);
        // logger.error('genProvidusAccount Error:', error);
        // return res.status(500).json({ status: false, message: 'Failed to generate virtual account.' });
    }
}

module.exports = {
    genPRVAccount
}