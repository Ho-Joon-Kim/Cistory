pipeline {
    agent any

    // The Integration Tests stage below runs a throwaway Postgres
    // (docker-compose.test.yml) with a hardcoded container name and host
    // port, torn down in `post { always }` as soon as that build's stage
    // finishes. Two builds overlapping on this agent would share that one
    // container — the second `up -d --wait` silently reuses the first
    // build's instance rather than failing on the port — and then whichever
    // build finishes first tears down the Postgres the other is still
    // mid-suite against. The rest of the pipeline already isn't
    // concurrency-safe either (Run Migrations and Deploy both use fixed
    // container names/ports against cistory-db), so this pipeline has never
    // actually supported concurrent runs — this just makes that assumption
    // explicit instead of leaving it to accidentally hold. A build-scoped
    // project name + dynamic port would fix the Integration Tests stage in
    // isolation but leave every other stage's fixed-name assumption
    // exactly as broken, so it wasn't worth the extra moving parts here: a
    // queued second build costs a wait, not a wrong result.
    options {
        disableConcurrentBuilds()
    }

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

        stage('Integration Tests') {
            steps {
                // src/**/*.integration.test.ts execute real SQL against a real
                // Postgres and cannot run inside `docker build` the way the Test
                // stage above does — a build has no network route to a sibling
                // service container. So this stage follows the same two-step
                // shape as "Run Migrations" below: build an image that HAS the
                // suite but doesn't run it, bring up a throwaway Postgres via
                // docker-compose.test.yml (its own project/network/port, never
                // cistory-db), then run the suite as a container reaching it over
                // --network host. Ungated by branch, like the Test stage above —
                // PRs get the same regression safety net as pushes to main.
                // DATABASE_URL is passed to the `npx tsx scripts/migrate.ts`
                // command only, not to the container (`-e` on `docker run`
                // would put it in the whole process's environment, and from
                // there vitest inherits it too). That distinction is
                // load-bearing, not tidiness: every integration test reaches
                // Postgres through the transaction-bound `executor` param
                // (src/db/testing/transactional-db.ts), never through the
                // app's own getDb()/getPool() singleton — but if DATABASE_URL
                // *were* sitting in the environment, code that forgot to pass
                // an executor would silently succeed via getDb()'s separate
                // pooled connection instead of failing loudly. That
                // connection can't see this run's uncommitted fixture rows
                // (they live inside one BEGIN/ROLLBACK transaction on a
                // different connection), so an isolation assertion like
                // "user B's rows aren't returned" would pass vacuously
                // because nothing came back at all — exactly the always-green
                // failure mode this whole suite exists to rule out, just
                // displaced from the test file into the CI environment.
                // TEST_DATABASE_URL stays container-wide because that's the
                // one name src/db/testing/transactional-db.ts trusts (no
                // DATABASE_URL fallback there either, for the same reason).
                sh """
                    docker build --target integration-tester -t ${IMAGE_NAME}:integration-tester .

                    docker compose -f docker-compose.test.yml up -d --wait

                    docker run --rm \
                        --network host \
                        -e TEST_DATABASE_URL=postgresql://cistory_test:cistory_test@localhost:5433/cistory_test \
                        ${IMAGE_NAME}:integration-tester \
                        sh -c "DATABASE_URL=postgresql://cistory_test:cistory_test@localhost:5433/cistory_test npx tsx scripts/migrate.ts && npx vitest run -c vitest.integration.config.mts"
                """
            }
            post {
                always {
                    sh "docker compose -f docker-compose.test.yml down || true"
                }
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
            when { branch 'main' }
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
            when { branch 'main' }
            steps {
                sh """
                    docker stop ${CONTAINER_NAME} 2>/dev/null || true
                    docker rm ${CONTAINER_NAME} 2>/dev/null || true
                    docker stop ${CONTAINER_NAME}-cron 2>/dev/null || true
                    docker rm ${CONTAINER_NAME}-cron 2>/dev/null || true

                    # Ensure PostgreSQL is running
                    docker start cistory-db 2>/dev/null || docker compose up -d postgres

                    COMPOSE_NETWORK=\$(docker inspect cistory-db --format '{{range \$k, \$v := .NetworkSettings.Networks}}{{\$k}}{{end}}')

                    # Web container — serves HTTP. Cron is DISABLED here so the
                    # background jobs never block the request-serving event loop.
                    docker run -d \
                        --name ${CONTAINER_NAME} \
                        --restart unless-stopped \
                        --env-file ${ENV_FILE} \
                        --network \${COMPOSE_NETWORK} \
                        -e NODE_ENV=production \
                        -e TZ=Asia/Seoul \
                        -e DISABLE_CRON=true \
                        -e DATABASE_URL=postgresql://cistory:cistory@cistory-db:5432/cistory \
                        -p ${APP_PORT}:3000 \
                        --log-driver json-file \
                        --log-opt max-size=50m \
                        --log-opt max-file=5 \
                        ${IMAGE_NAME}:${GIT_COMMIT_SHORT}

                    # Cron container — same image, runs the scheduler only. No
                    # published port (no web traffic), so its event loop is free
                    # to run CPU-heavy background jobs without affecting the web
                    # container.
                    docker run -d \
                        --name ${CONTAINER_NAME}-cron \
                        --restart unless-stopped \
                        --env-file ${ENV_FILE} \
                        --network \${COMPOSE_NETWORK} \
                        -e NODE_ENV=production \
                        -e TZ=Asia/Seoul \
                        -e DATABASE_URL=postgresql://cistory:cistory@cistory-db:5432/cistory \
                        --log-driver json-file \
                        --log-opt max-size=50m \
                        --log-opt max-file=5 \
                        ${IMAGE_NAME}:${GIT_COMMIT_SHORT}
                """
            }
        }

        stage('Health Check') {
            when { branch 'main' }
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

                    def cronHealthy = false
                    for (int i = 0; i < 15; i++) {
                        def exitCode = sh(
                            script: "docker inspect -f '{{.State.Running}}' ${CONTAINER_NAME}-cron | grep -q true && docker exec ${CONTAINER_NAME}-cron test -f /tmp/cistory-cron-ready",
                            returnStatus: true
                        )
                        if (exitCode == 0) {
                            cronHealthy = true
                            echo "Cron health check passed (attempt ${i + 1})"
                            break
                        }
                        echo "Cron health check attempt ${i + 1}/15 - exit code: ${exitCode}"
                        sleep 5
                    }
                    if (!cronHealthy) {
                        echo "Cron container logs:"
                        sh "docker logs ${CONTAINER_NAME}-cron --tail 100 || true"
                        error("Cron health check failed after 15 attempts")
                    }
                }
            }
        }

        stage('Cleanup') {
            when { branch 'main' }
            steps {
                // Excludes every reused singleton tag (latest, tester,
                // integration-tester, migrator), not just latest — those are
                // retagged onto the newest image on every single build, so
                // they always lexically outrank a 7-char hex sha tag
                // ('i'/'m'/'t' > any '0'-'9'/'a'-'f' first character) and
                // would otherwise occupy `tail -n +4`'s "keep" slots that are
                // meant for actual commit-sha rollback targets. Before
                // integration-tester existed this already silently kept only
                // 1 real sha (tester + migrator ate 2 of the 3 slots);
                // adding a third reused tag would have evicted all of them.
                sh """
                    docker images ${IMAGE_NAME} --format '{{.Tag}}' \
                        | grep -vE '^(latest|tester|integration-tester|migrator)\$' \
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
                // Deploy notifications only for the main deploy (Test/Build-only
                // branch & PR builds don't deploy, so "배포 성공" would be misleading).
                if (env.BRANCH_NAME != 'main') { return }
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
                if (env.BRANCH_NAME != 'main') { return }
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
