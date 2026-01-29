const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const onboardingController = require('../../controllers/businessControllers/onboarding');

// We create a mini-app to test just the route registration
const app = express();
app.use(bodyParser.json());
app.post('/newbizreg', onboardingController.BusinessRegistrationWeb);

describe('Onboarding Route Integration', () => {
    test('POST /newbizreg should reach controller and return 400 on empty body', async () => {
        const response = await request(app)
            .post('/newbizreg')
            .send({}); 
        
        expect(response.status).toBe(400);
        expect(response.body.status).toBe(false);
    });
});