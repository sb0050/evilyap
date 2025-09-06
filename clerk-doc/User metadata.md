User metadata
Metadata allows for custom data to be saved on the User object. There are three types of metadata: "unsafe", "public", and "private".

Metadata	Frontend API	Backend API
Private	No read or write access	Read & write access
Public	Read access	Read & write access
Unsafe	Read & write access	Read & write access  

Private metadata
Private metadata is only accessible by the backend, which makes this useful for storing sensitive data that you don't want to expose to the frontend. For example, you could store a user's Stripe customer ID.

Set private metadata

import { clerkClient } from '@clerk/express'

app.post('/updateStripe', async (req, res) => {
  const { stripeId, userId } = req.body

  await clerkClient.users.updateUserMetadata(userId, {
    privateMetadata: {
      stripeId: stripeId,
    },
  })

  res.status(200).json({ success: true })
})

Retrieve private metadata
You can retrieve the private metadata for a user by using the JavaScript Backend SDK's 
getUser()
 method. This method will return the User object which contains the private metadata.

 import { clerkClient } from '@clerk/express'

app.post('/updateStripe', async (req, res) => {
  const { userId } = req.body

  const user = await clerkClient.users.getUser(userId)

  res.status(200).json(user.privateMetadata)
})

Public metadata
Public metadata is accessible by both the frontend and the backend, but can only be set on the backend. This is useful for storing data that you want to expose to the frontend, but don't want the user to be able to modify. For example, you could store a custom role for a user.

Set public metadata

import { clerkClient } from '@clerk/express'

app.post('/updateRole', async (req, res) => {
  const { role, userId } = req.body

  await clerkClient.users.updateUserMetadata(userId, {
    publicMetadata: {
      role,
    },
  })
  res.status(200).json({ success: true })
})

Retrieve public metadata
There are multiple ways to retrieve public metadata.

On the frontend, it's available on the 
User
 object which can be accessed using the 
useUser()
 hook.

On the backend, it's available on the 
Backend User
 object which can be accessed using the JavaScript Backend SDK's 
getUser()
 method. However, this makes an API request, which is subject to rate limits. To avoid an API request, you can attach the metadata as a claim in the user's session token. Then, the metadata can be retrieved from the sessionClaims on the 
Auth
 object. See the guide on customizing your session token.

Unsafe metadata
Unsafe metadata can be both read and set from the frontend and the backend. It's called "unsafe" metadata because it can be modified directly from the frontend, which means malicious users could potentially tamper with these values.

Unsafe metadata is the only metadata property that can be set during sign-up, so a common use case is to use it in 
custom onboarding flows
. Custom data collected during the onboarding (sign-up) flow can be stored in the 
SignUp
 object. After a successful sign-up, SignUp.unsafeMetadata is copied to the User object as User.unsafeMetadata. From that point on, the unsafe metadata is accessible as a direct attribute of the User object.

Set unsafe metadata
The following examples demonstrate how to update unsafe metadata for an existing user. Updating unsafeMetadata replaces the previous value; it doesn't perform a merge. To merge data, you can pass a combined object such as { …user.unsafeMetadata, …newData } to the unsafeMetadata parameter.

The following examples demonstrate how to update unsafeMetadata using the Backend API or the Frontend SDKs.

Using the Backend API


import { clerkClient } from '@clerk/express'

app.post('/updateStripe', async (req, res) => {
  const { stripeId, userId } = await req.body

  await clerkClient.users.updateUserMetadata(userId, {
    unsafeMetadata: {
      birthday: '11-30-1969',
    },
  })

  res.status(200).json({ success: true })
})

Using the Frontend SDKs

export default function Page() {
  const { user } = useUser()
  const [birthday, setBirthday] = useState('')

  return (
    <div>
      <input type="text" value={birthday} onChange={(e) => setBirthday(e.target.value)} />

      <button
        onClick={() => {
          user?.update({
            unsafeMetadata: { birthday },
          })
        }}
      >
        Update birthday
      </button>
    </div>
  )
}

Retrieve unsafe metadata
There are multiple ways to retrieve unsafe metadata.

On the frontend, it is available on the 
User
 object, which you can access by using the 
useUser()
 hook.

On the backend, it's available on the 
Backend User
 object which can be accessed using the JavaScript Backend SDK's 
getUser()
 method. It can also be attached to a session token, and the sessionClaims of the session token can be retrieved on the 
Auth
 object. If you need to retrieve unsafe metadata frequently in the backend, the best option is to attach it to the session token and retrieve it from the session token. See the guide on customizing your session token.