import Fastify from 'fastify';
import jwt from '@fastify/jwt';

import { env } from './config/env.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { crmRoutes } from './routes/crm/index.js';
import { projectsRoutes } from './routes/projects/index.js';
import { financialRoutes } from './routes/financial/index.js';
import { supportRoutes } from './routes/support/index.js';
import { customerSuccessRoutes } from './routes/customer-success/index.js';
import { agentsModuleRoutes } from './routes/agents/index.js';
import { usersRoutes } from './routes/users.js';

export function buildApp() {
    const app = Fastify({
        logger: true,
    });

    app.register(jwt, {
        secret: env.JWT_SECRET,
        sign: {
            expiresIn: env.JWT_EXPIRES_IN,
        },
    });

    app.register(healthRoutes);

    app.register(authRoutes, {
        prefix: '/auth',
    });

    app.register(adminRoutes, {
        prefix: '/admin',
    });

    app.register(crmRoutes, {
        prefix: '/crm',
    });

    app.register(projectsRoutes, {
        prefix: '/projects',
    });

    app.register(financialRoutes, {
        prefix: '/financial',
    });

    app.register(supportRoutes, {
        prefix: '/support',
    });

    app.register(customerSuccessRoutes, {
        prefix: '/customer-success',
    });

    app.register(usersRoutes, {
        prefix: '/users',
    });

    app.register(agentsModuleRoutes, {
        prefix: '/agents',
    });

    return app;
}