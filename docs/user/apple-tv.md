# Apple TV

Turn on **Apple TV doorbell** in **Settings → TV** to get alerts on your TV when a thread needs approval or input, finishes, or fails. T3 Code appears in HomeKit as a video doorbell, and Apple TV shows a picture-in-picture card with the thread name, status, project, and branch over whatever is playing. Choose which of those events ring in the same section.

To add the doorbell, scan the code shown in **Settings → TV** with the Home app on an iPhone in the same Home as your Apple TV, or enter the setup code. Home warns that the accessory is uncertified; add it anyway. Use **Test ring** to check it. **Reset pairing** forgets the current Home and shows a new code; remove the old T3 Code doorbell from the Home app too.

The doorbell needs a home hub (an Apple TV or HomePod), and your Apple TV must be able to reach the computer running T3 Code on your local network. If they are on different networks or VLANs, allow traffic and Bonjour between them. Apple TV shows the card as a still picture; live video is not available. Turning the setting off stops the doorbell.

The tvOS app in `apps/tv` shows your threads as a board, opens live thread detail, and lets you approve requests and answer agent questions with the Siri Remote. Pair it with a pairing link from **Settings → Sharing & access**. To disconnect, press Up on the board, choose **Connection**, then **Forget**.
