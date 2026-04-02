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

        stage('Build Docker Image') {
            steps {
                sh """
                    DOCKER_BUILDKIT=1 docker build \
                        --secret id=env,src=${ENV_FILE} \
                        -t ${IMAGE_NAME}:${GIT_COMMIT_SHORT} \
                        -t ${IMAGE_NAME}:latest \
                        .
                """
            }
        }

        stage('Run Migrations') {
            steps {
                sh """
                    # Ensure PostgreSQL is running (skip if container already exists from manual setup)
                    docker start cistory-db 2>/dev/null || docker compose up -d postgres

                    docker build --target builder -t ${IMAGE_NAME}:builder .
                    docker run --rm \
                        --env-file ${ENV_FILE} \
                        --network host \
                        -e DATABASE_URL=postgresql://cistory:cistory@localhost:5432/cistory \
                        ${IMAGE_NAME}:builder \
                        npx drizzle-kit migrate
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
