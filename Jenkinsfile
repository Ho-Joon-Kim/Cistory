pipeline {
    agent any

    triggers {
        githubPush()
    }

    environment {
        IMAGE_NAME = 'cistory'
        CONTAINER_NAME = 'cistory'
        APP_PORT = '3000'
        ENV_FILE = '/home/hojoon-1/git/Cistory/.env'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                script {
                    env.GIT_COMMIT_SHORT = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    env.GIT_COMMIT_MSG = sh(script: 'git log -1 --pretty=%s', returnStdout: true).trim()
                    env.GIT_AUTHOR = sh(script: 'git log -1 --pretty=%an', returnStdout: true).trim()
                }
            }
        }

        stage('Test') {
            steps {
                // Build the tester target; its `RUN yarn test` fails the build
                // (non-zero exit) if any Vitest test fails, stopping the
                // pipeline before the image is built or deployed.
                sh "docker build --target tester -t ${IMAGE_NAME}:tester ."
            }
        }

        stage('Build Docker Image') {
            steps {
                script {
                    def envVars = [:]
                    ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_MAPBOX_TOKEN', 'NEXT_PUBLIC_SENTRY_DSN'].each { key ->
                        def val = sh(script: "grep '^${key}=' ${ENV_FILE} | cut -d= -f2- | tr -d \"'\\\"\"", returnStdout: true).trim()
                        envVars[key] = val
                    }
                    sh """
                        docker build \
                            --build-arg NEXT_PUBLIC_APP_URL="${envVars.NEXT_PUBLIC_APP_URL}" \
                            --build-arg NEXT_PUBLIC_MAPBOX_TOKEN="${envVars.NEXT_PUBLIC_MAPBOX_TOKEN}" \
                            --build-arg NEXT_PUBLIC_SENTRY_DSN="${envVars.NEXT_PUBLIC_SENTRY_DSN}" \
                            -t ${IMAGE_NAME}:${GIT_COMMIT_SHORT} \
                            -t ${IMAGE_NAME}:latest \
                            .
                    """
                }
            }
        }

        stage('Run Migrations') {
            steps {
                sh """
                    # Ensure PostgreSQL is running (skip if container already exists from manual setup)
                    docker start cistory-db 2>/dev/null || docker compose up -d postgres

                    # Defense: kill any stale migration/drizzle sessions from previous builds.
                    # A dropped psql connection mid-transaction leaves a row in pg_stat_activity
                    # with state='idle in transaction', holding row locks on __drizzle_migrations
                    # and blocking every subsequent migration attempt. Build #64 hung for 15+ min
                    # behind one of these; guard against it here.
                    docker exec cistory-db psql -U cistory -d cistory -v ON_ERROR_STOP=0 -c "
                        SELECT pg_terminate_backend(pid)
                        FROM pg_stat_activity
                        WHERE datname = 'cistory'
                          AND pid <> pg_backend_pid()
                          AND state = 'idle in transaction'
                          AND (now() - state_change) > interval '5 minutes'
                          AND (query ILIKE '%drizzle%' OR query ILIKE '%ALTER TABLE%' OR query ILIKE '%CREATE TABLE%');
                    " || true

                    docker build \
                        --target migrator -t ${IMAGE_NAME}:migrator .
                    docker run --rm \
                        --network host \
                        -e DATABASE_URL=postgresql://cistory:cistory@localhost:5432/cistory \
                        ${IMAGE_NAME}:migrator \
                        npx tsx scripts/migrate.ts
                """
            }
        }

        stage('Deploy') {
            steps {
                sh """
                    docker stop ${CONTAINER_NAME} 2>/dev/null || true
                    docker rm ${CONTAINER_NAME} 2>/dev/null || true

                    # Ensure PostgreSQL is running
                    docker start cistory-db 2>/dev/null || docker compose up -d postgres

                    COMPOSE_NETWORK=\$(docker inspect cistory-db --format '{{range \$k, \$v := .NetworkSettings.Networks}}{{\$k}}{{end}}')

                    docker run -d \
                        --name ${CONTAINER_NAME} \
                        --restart unless-stopped \
                        --env-file ${ENV_FILE} \
                        --network \${COMPOSE_NETWORK} \
                        -e NODE_ENV=production \
                        -e TZ=Asia/Seoul \
                        -e DATABASE_URL=postgresql://cistory:cistory@cistory-db:5432/cistory \
                        -p ${APP_PORT}:3000 \
                        --log-driver json-file \
                        --log-opt max-size=50m \
                        --log-opt max-file=5 \
                        ${IMAGE_NAME}:${GIT_COMMIT_SHORT}
                """
            }
        }

        stage('Health Check') {
            steps {
                script {
                    sleep 3
                    def healthy = false
                    for (int i = 0; i < 15; i++) {
                        def exitCode = sh(
                            script: "curl -sf http://localhost:${APP_PORT}/api/health -o /dev/null",
                            returnStatus: true
                        )
                        if (exitCode == 0) {
                            healthy = true
                            echo "Health check passed (attempt ${i + 1})"
                            break
                        }
                        echo "Health check attempt ${i + 1}/15 - curl exit code: ${exitCode}"
                        sleep 5
                    }
                    if (!healthy) {
                        echo "Container logs:"
                        sh "docker logs ${CONTAINER_NAME} --tail 50"
                        error("Health check failed after 15 attempts")
                    }
                }
            }
        }

        stage('Cleanup') {
            steps {
                sh """
                    docker images ${IMAGE_NAME} --format '{{.Tag}}' \
                        | grep -v latest \
                        | sort -r \
                        | tail -n +4 \
                        | xargs -r -I {} docker rmi ${IMAGE_NAME}:{} 2>/dev/null || true
                """
            }
        }
    }

    post {
        success {
            script {
                def duration = currentBuild.durationString.replace(' and counting', '')
                withCredentials([
                    string(credentialsId: 'telegram-bot-token', variable: 'BOT_TOKEN'),
                    string(credentialsId: 'telegram-chat-id', variable: 'CHAT_ID')
                ]) {
                    sh '''
                        curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
                            -d chat_id="${CHAT_ID}" \
                            -d parse_mode="HTML" \
                            -d text="''' + "✅ <b>Cistory 배포 성공</b>%0A%0A📦 <code>${env.GIT_COMMIT_SHORT}</code> ${env.GIT_COMMIT_MSG}%0A👤 ${env.GIT_AUTHOR}%0A⏱ ${duration}" + '''"
                    '''
                }
            }
        }
        failure {
            script {
                withCredentials([
                    string(credentialsId: 'telegram-bot-token', variable: 'BOT_TOKEN'),
                    string(credentialsId: 'telegram-chat-id', variable: 'CHAT_ID')
                ]) {
                    sh '''
                        curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
                            -d chat_id="${CHAT_ID}" \
                            -d parse_mode="HTML" \
                            -d text="''' + "❌ <b>Cistory 배포 실패</b>%0A%0A📦 <code>${env.GIT_COMMIT_SHORT}</code> ${env.GIT_COMMIT_MSG}%0A👤 ${env.GIT_AUTHOR}%0A🔗 ${env.BUILD_URL}" + '''"
                    '''
                }
            }
        }
    }
}
