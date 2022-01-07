import admin from "firebase-admin"
import axios from "axios"
import config from "./config.json"
import express from "express"
import { OBJECT, STRING, validate_express } from "validate-any"
import { Octokit } from "@octokit/core"
import { useTryAsync } from "no-try"

const app = express()
const PORT = 4567

admin.initializeApp({ credential: admin.credential.cert(config.firebase) })
const db = admin.firestore()

app.use(express.json())

app.post(
	"/create-webhook",
	validate_express(
		OBJECT({
			username: STRING(),
			repository: STRING(),
			access_token: STRING()
		})
	),
	async (req, res) => {
		const { username, repository, access_token } = req.body
		const octokit = new Octokit({ auth: access_token })

		octokit
			.request("POST /repos/{owner}/{repo}/hooks", {
				owner: username,
				repo: repository,
				name: "web",
				active: true,
				events: ["push"],
				config: {
					url: "https://gitcat.zectan.com/handle-commit",
					content_type: "json"
				}
			})
			.then(() => res.status(201).send({}))
			.catch(err => res.status(400).send(err))
	}
)

app.post("/handle-commit", async (req, res) => {
	const commits = req.body.commits as Record<string, any>[] | undefined
	if (commits) {
		const user_id = req.body.sender.id as number
		const ref = db.collection("users").doc(user_id.toString())

		const [err] = await useTryAsync(async () => {
			const doc = await ref.get()
			if (doc.exists) {
				await ref.update({
					credits: admin.firestore.FieldValue.increment(commits.length)
				})
			} else {
				await ref.set({
					credits: commits.length
				})
			}
		})

		if (err) {
			res.status(404).send(err)
		} else {
			res.status(200).end()
		}
	} else {
		res.end()
	}
})

app.post(
	"/repos",
	validate_express(
		OBJECT({
			username: STRING()
		})
	),
	async (req, res) => {
		const { username } = req.body
		const octokit = new Octokit()

		octokit
			.request("GET /users/{username}/repos", {
				username
			})
			.then(({ data: repos }) => {
				res.status(200).send(
					repos.map(repo => ({
						name: repo.name,
						description: repo.description
					}))
				)
			})
			.catch(err => res.status(400).send(err))
	}
)

app.post(
	"/user",
	validate_express(
		OBJECT({
			access_token: STRING()
		})
	),
	async (req, res) => {
		axios
			.get("https://api.github.com/user", {
				headers: { Authorization: `token ${req.body.access_token}` }
			})
			.then(user => {
				res.status(200).send({
					id: user.data.id,
					username: user.data.login
				})
			})
			.catch(err => res.status(400).send(err))
	}
)

app.get("/start-oauth", (req, res) => {
	const url = new URL("https://github.com/login/oauth/authorize")
	url.searchParams.set("client_id", "d798948d956d46016e47")
	url.searchParams.set("redirect_uri", "https://gitcat.zectan.com/handle-oauth")
	url.searchParams.set("scope", "repo, admin:repo_hook")
	res.redirect(url.href)
})

app.get("/handle-oauth", async (req, res) => {
	axios
		.post(
			"https://github.com/login/oauth/access_token",
			{
				client_id: config.github.client_id,
				client_secret: config.github.client_secret,
				code: req.query.code as string
			},
			{
				headers: {
					Accept: "application/json"
				}
			}
		)
		.then(res_ => {
			const { access_token } = res_.data
			const url = new URL("cat://www.gitcat.com")
			url.searchParams.set("access_token", encodeURIComponent(access_token))
			res.redirect(url.href)
		})
		.catch(err => res.status(400).send(err))
})

app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
